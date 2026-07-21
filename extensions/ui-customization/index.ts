import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { basename } from "node:path";
import { homedir } from "node:os";

const ART = [
  "      __          __               __",
  " ____/ /_  __  __/ /_  ____ ______/ /_",
  "/ ___/ __ \\/ / / / __ \\/ __ `/ ___/ __ \\",
  "/ /  / / / / /_/ / /_/ / /_/ / /  / /_/ /",
  "/_/  /_/ /_/\\__,_/_.___/\\__,_/_/  /_.___/",
];
const GRADIENT = [
  [203, 166, 247],
  [245, 194, 231],
  [250, 179, 135],
  [249, 226, 175],
  [166, 227, 161],
  [137, 180, 250],
] as const;

interface GitInfo {
  branch?: string;
  changed: number;
  pr?: { number: number; url: string };
}

export default function uiCustomizationExtension(pi: ExtensionAPI) {
  let render: (() => void) | undefined;
  let git: GitInfo = { changed: 0 };
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let responseStartedAt: number | undefined;
  let tokensPerSecond: number | undefined;

  async function refreshGit(ctx: ExtensionContext) {
    const branch = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: ctx.cwd,
      timeout: 3000,
    });
    if (branch.code !== 0) {
      git = { changed: 0 };
      render?.();
      return;
    }
    const status = await pi.exec("git", ["status", "--porcelain"], {
      cwd: ctx.cwd,
      timeout: 3000,
    });
    const changed =
      status.code === 0
        ? status.stdout.split(/\r?\n/).filter(Boolean).length
        : 0;
    let pr: GitInfo["pr"];
    const prResult = await pi
      .exec("gh", ["pr", "view", "--json", "number,url"], {
        cwd: ctx.cwd,
        timeout: 3000,
      })
      .catch(() => undefined);
    if (prResult?.code === 0) {
      try {
        const value = JSON.parse(prResult.stdout) as {
          number?: unknown;
          url?: unknown;
        };
        if (typeof value.number === "number" && typeof value.url === "string")
          pr = { number: value.number, url: value.url };
      } catch {}
    }
    git = { branch: branch.stdout.trim(), changed, pr };
    render?.();
  }

  function scheduleGit(ctx: ExtensionContext) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => void refreshGit(ctx), 150);
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    scheduleGit(ctx);
    ctx.ui.setTitle(`rhubarb · ${formatDirectory(ctx.cwd)}`);
    ctx.ui.setHeader((tui) => {
      render = () => tui.requestRender();
      return {
        render(width: number) {
          return [
            "",
            ...ART.map((line, row) =>
              center(gradient(line, row * 0.08), width),
            ),
            center(gradient("rhubarb", 0.35), width),
            "",
          ];
        },
        invalidate() {},
      };
    });
    ctx.ui.setFooter((tui, theme, footerData) => {
      render = () => tui.requestRender();
      return {
        render(width: number) {
          const model = ctx.model
            ? `${ctx.model.provider}/${ctx.model.id} · ${pi.getThinkingLevel()}`
            : "no model";
          const usage = ctx.getContextUsage();
          const percent =
            usage?.percent == null ? "?" : String(Math.round(usage.percent));
          const window = formatTokens(ctx.model?.contextWindow ?? 0);
          const cost = totalCost(ctx);
          const speed =
            tokensPerSecond === undefined
              ? "— tok/s"
              : `${Math.round(tokensPerSecond)} tok/s`;
          const gitText = git.branch
            ? `${git.branch} · ${git.changed} ${git.changed === 1 ? "file" : "files"} changed${git.pr ? ` · PR #${git.pr.number}` : ""}`
            : "";
          const lines = [
            columns(
              theme.fg("text", formatDirectory(ctx.cwd)),
              theme.fg("muted", model),
              width,
            ),
            columns(
              theme.fg(
                "muted",
                `${percent}%/${window} · $${cost.toFixed(2)} · ${speed}`,
              ),
              theme.fg("muted", gitText),
              width,
            ),
          ];
          for (const [, status] of [...footerData.getExtensionStatuses()].sort(
            ([a], [b]) => a.localeCompare(b),
          )) {
            for (const line of status.split("\n"))
              lines.push(truncateToWidth(line, width, "…"));
          }
          return lines;
        },
        invalidate() {},
      };
    });
  });

  pi.on("message_start", (event) => {
    if (event.message.role === "assistant") responseStartedAt = Date.now();
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant" || responseStartedAt === undefined)
      return;
    const elapsed = (Date.now() - responseStartedAt) / 1000;
    if (elapsed > 0 && event.message.usage?.output)
      tokensPerSecond = event.message.usage.output / elapsed;
    responseStartedAt = undefined;
    render?.();
  });
  pi.on("model_select", () => render?.());
  pi.on("thinking_level_select", () => render?.());
  pi.on("tool_execution_end", (event, ctx) => {
    if (["bash", "edit", "write"].includes(event.toolName)) scheduleGit(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = undefined;
    render = undefined;
    if (ctx.mode === "tui") {
      ctx.ui.setHeader(undefined);
      ctx.ui.setFooter(undefined);
    }
  });
}

function totalCost(ctx: ExtensionContext) {
  let total = 0;
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "assistant")
      continue;
    total += entry.message.usage?.cost?.total ?? 0;
  }
  return total;
}
function formatDirectory(cwd: string) {
  const home = homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}/`)) return `~/${cwd.slice(home.length + 1)}`;
  return basename(cwd) || cwd;
}
function formatTokens(value: number) {
  if (!value) return "?";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}
export function columns(left: string, right: string, width: number) {
  const gap = width - visibleWidth(left) - visibleWidth(right);
  if (gap >= 1) return `${left}${" ".repeat(gap)}${right}`;
  return truncateToWidth(`${left} ${right}`, width, "…");
}
export function center(value: string, width: number) {
  const pad = Math.max(0, Math.floor((width - visibleWidth(value)) / 2));
  return truncateToWidth(`${" ".repeat(pad)}${value}`, width, "");
}
export function gradient(value: string, offset = 0) {
  const chars = [...value];
  return (
    chars
      .map((char, index) => {
        const position =
          chars.length <= 1
            ? offset
            : (index / (chars.length - 1) + offset) % 1;
        const scaled = position * (GRADIENT.length - 1);
        const start = Math.floor(scaled);
        const end = Math.min(GRADIENT.length - 1, start + 1);
        const amount = scaled - start;
        const rgb = GRADIENT[start].map((channel, i) =>
          Math.round(channel + (GRADIENT[end][i] - channel) * amount),
        );
        return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${char}`;
      })
      .join("") + "\x1b[0m"
  );
}
