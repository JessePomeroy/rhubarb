import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";

interface ChangedFile {
  status: string;
  path: string;
}

export default function convenienceExtension(pi: ExtensionAPI) {
  pi.registerCommand("lg", {
    description: "Browse changed files and their diffs",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify(
          "The changes browser requires interactive mode.",
          "warning",
        );
        return;
      }
      const status = await pi.exec(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=all"],
        { cwd: ctx.cwd, signal: ctx.signal, timeout: 5000 },
      );
      if (status.code !== 0) {
        ctx.ui.notify("Not a Git repository.", "warning");
        return;
      }
      const files = parseChangedFiles(status.stdout);
      if (!files.length) {
        ctx.ui.notify("Working tree is clean.", "info");
        return;
      }
      while (true) {
        const labels = files.map(
          (file) => `${file.status.padEnd(2)} ${file.path}`,
        );
        const choice = await ctx.ui.select("Changed files", labels, {
          signal: ctx.signal,
        });
        if (!choice) return;
        const file = files[labels.indexOf(choice)];
        const diff = await fileDiff(pi, ctx, file);
        await ctx.ui.editor(
          `${file.status} ${file.path}`,
          diff || "(no textual diff)",
        );
      }
    },
  });

  pi.registerCommand("pr", {
    description: "Show pull request details for the current branch",
    handler: async (_args, ctx) => {
      const result = await pi.exec(
        "gh",
        [
          "pr",
          "view",
          "--json",
          "number,url,title,state,headRefName,baseRefName",
        ],
        {
          cwd: ctx.cwd,
          signal: ctx.signal,
          timeout: 10_000,
        },
      );
      if (result.code !== 0) {
        ctx.ui.notify(
          result.stderr.trim() ||
            "No pull request found for the current branch.",
          "warning",
        );
        return;
      }
      try {
        const pr = JSON.parse(result.stdout) as Record<string, unknown>;
        ctx.ui.notify(
          `PR #${pr.number}: ${pr.title}\n${pr.headRefName} → ${pr.baseRefName} · ${pr.state}\n${pr.url}`,
          "info",
        );
      } catch {
        ctx.ui.notify(
          "GitHub CLI returned invalid pull-request data.",
          "warning",
        );
      }
    },
  });

  pi.registerCommand("copy-all", {
    description: "Copy all user and assistant messages in this branch",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();
      const text = transcriptText(ctx);
      if (!text) {
        ctx.ui.notify("No user or assistant messages to copy.", "info");
        return;
      }
      const backend = await copyToClipboard(text, ctx.signal);
      const count = ctx.sessionManager
        .getBranch()
        .filter(
          (entry) =>
            entry.type === "message" &&
            (entry.message.role === "user" ||
              entry.message.role === "assistant"),
        ).length;
      ctx.ui.notify(`Copied ${count} messages with ${backend}.`, "info");
    },
  });
}

export function parseChangedFiles(output: string): ChangedFile[] {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const status = line.slice(0, 2);
      let path = line.slice(3).trim();
      const rename = path.lastIndexOf(" -> ");
      if (rename >= 0) path = path.slice(rename + 4);
      if (path.startsWith('"') && path.endsWith('"')) {
        try {
          path = JSON.parse(path) as string;
        } catch {}
      }
      return { status, path };
    });
}

async function fileDiff(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  file: ChangedFile,
) {
  if (file.status === "??") {
    const result = await pi.exec(
      "git",
      ["diff", "--no-index", "--", "/dev/null", file.path],
      { cwd: ctx.cwd, signal: ctx.signal, timeout: 10_000 },
    );
    return result.stdout || result.stderr;
  }
  const [unstaged, staged] = await Promise.all([
    pi.exec("git", ["diff", "--no-ext-diff", "--", file.path], {
      cwd: ctx.cwd,
      signal: ctx.signal,
      timeout: 10_000,
    }),
    pi.exec("git", ["diff", "--cached", "--no-ext-diff", "--", file.path], {
      cwd: ctx.cwd,
      signal: ctx.signal,
      timeout: 10_000,
    }),
  ]);
  return [
    staged.stdout && `# Staged\n\n${staged.stdout}`,
    unstaged.stdout && `# Unstaged\n\n${unstaged.stdout}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function transcriptText(ctx: ExtensionContext) {
  return ctx.sessionManager
    .getBranch()
    .filter((entry) => entry.type === "message")
    .map((entry) => entry.message)
    .filter(
      (message) => message.role === "user" || message.role === "assistant",
    )
    .map((message) => ({
      role: message.role.toUpperCase(),
      content: contentText(message.content).trim(),
    }))
    .filter((item) => item.content)
    .map((item) => `${item.role}:\n${item.content}`)
    .join("\n\n---\n\n");
}

function contentText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object" || !("type" in part)) return "";
      if (
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string"
      )
        return part.text;
      if (part.type === "image") return "[image]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

async function copyToClipboard(text: string, signal?: AbortSignal) {
  const candidates: Array<{ name: string; command: string; args: string[] }> =
    process.platform === "darwin"
      ? [{ name: "pbcopy", command: "pbcopy", args: [] }]
      : process.platform === "win32"
        ? [{ name: "clip.exe", command: "clip.exe", args: [] }]
        : [
            {
              name: "wl-copy",
              command: "wl-copy",
              args: ["--type", "text/plain"],
            },
            {
              name: "xclip",
              command: "xclip",
              args: ["-selection", "clipboard"],
            },
            { name: "xsel", command: "xsel", args: ["--clipboard", "--input"] },
          ];
  let lastError = "No clipboard backend found.";
  for (const candidate of candidates) {
    try {
      await pipeTo(candidate.command, candidate.args, text, signal);
      return candidate.name;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError);
}

function pipeTo(
  command: string,
  args: string[],
  text: string,
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(stderr.trim() || `${command} exited with code ${code}`),
          ),
    );
    if (signal) {
      const abort = () => {
        child.kill();
        reject(signal.reason ?? new Error("Copy cancelled."));
      };
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }
    child.stdin.end(text);
  });
}
