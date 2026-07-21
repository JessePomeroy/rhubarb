import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { BackgroundTerminalManager, type TerminalRecord } from "./manager.ts";

export default function backgroundTerminalsExtension(pi: ExtensionAPI) {
  let manager: BackgroundTerminalManager | undefined;
  let unsubscribe: (() => void) | undefined;
  const delivered = new Set<string>();
  const intentionalKills = new Set<string>();
  let widgetSignature = "";

  const required = () => {
    if (!manager) throw new Error("Background terminal manager is not ready.");
    return manager;
  };

  pi.on("session_start", (_event, ctx) => {
    manager = new BackgroundTerminalManager();
    unsubscribe = manager.subscribe((changed) => {
      const running = manager?.running() ?? [];
      ctx.ui.setStatus(
        "background-terminals",
        running.length ? `bg:${running.length}` : undefined,
      );
      const signature = running
        .map((record) => `${record.id}:${record.title}`)
        .join("|");
      if (signature !== widgetSignature) {
        widgetSignature = signature;
        ctx.ui.setWidget(
          "background-terminals",
          running.length
            ? running.map((record) => `● ${record.id} ${record.title}`)
            : undefined,
          { placement: "belowEditor" },
        );
      }
      if (
        !changed ||
        changed.status === "running" ||
        delivered.has(changed.id) ||
        intentionalKills.has(changed.id)
      )
        return;
      delivered.add(changed.id);
      pi.sendMessage(
        {
          customType: "background-terminal-result",
          content: completionText(changed),
          display: true,
          details: summary(changed),
        },
        { deliverAs: "followUp", triggerTurn: true },
      );
    });
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    unsubscribe?.();
    unsubscribe = undefined;
    const active = manager?.running() ?? [];
    for (const record of active) intentionalKills.add(record.id);
    await manager?.dispose();
    manager = undefined;
    delivered.clear();
    intentionalKills.clear();
    widgetSignature = "";
    ctx.ui.setStatus("background-terminals", undefined);
    ctx.ui.setWidget("background-terminals", undefined);
  });

  pi.registerTool({
    name: "bg_start",
    label: "Start Background Terminal",
    description:
      "Start a long-running non-interactive shell command in a session-scoped background terminal.",
    promptSnippet: "Start a long-running command without blocking the agent",
    promptGuidelines: [
      "Use bg_start for servers, watchers, and streaming builds; use bash for quick commands.",
    ],
    parameters: Type.Object({
      command: Type.String({ minLength: 1 }),
      title: Type.String({ minLength: 1, maxLength: 120 }),
      working_dir: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const cwd = resolve(ctx.cwd, params.working_dir ?? ".");
      if (!existsSync(cwd) || !statSync(cwd).isDirectory())
        throw new Error(`working_dir is not a directory: ${cwd}`);
      const record = required().start(params.command, params.title.trim(), cwd);
      return {
        content: [
          {
            type: "text",
            text: `Started ${record.id} "${record.title}" (pid ${record.pid ?? "unknown"}). Use bg_status or /ps to inspect it.`,
          },
        ],
        details: summary(record),
      };
    },
  });

  pi.registerTool({
    name: "bg_status",
    label: "Background Terminal Status",
    description:
      "Inspect one background terminal and a bounded tail of its output.",
    parameters: Type.Object({ id: Type.String() }),
    async execute(_id, params) {
      const record = required().get(params.id);
      if (!record) throw new Error(`Unknown background terminal: ${params.id}`);
      return {
        content: [{ type: "text", text: recordText(record) }],
        details: summary(record),
      };
    },
  });

  pi.registerTool({
    name: "bg_list",
    label: "List Background Terminals",
    description: "List all background terminals tracked in this session.",
    parameters: Type.Object({}),
    async execute() {
      const records = required().list();
      return {
        content: [
          {
            type: "text",
            text: records.length
              ? records
                  .map(
                    (record) =>
                      `${record.id} [${record.status}] pid=${record.pid ?? "?"} "${record.title}"`,
                  )
                  .join("\n")
              : "No background terminals.",
          },
        ],
        details: { terminals: records.map(summary) },
      };
    },
  });

  pi.registerTool({
    name: "bg_kill",
    label: "Kill Background Terminal",
    description:
      "Terminate a background terminal and its complete process group.",
    parameters: Type.Object({ id: Type.String() }),
    async execute(_id, params) {
      intentionalKills.add(params.id);
      const record = await required().kill(params.id);
      return {
        content: [
          { type: "text", text: `Stopped ${record.id} "${record.title}".` },
        ],
        details: summary(record),
      };
    },
  });

  pi.registerCommand("ps", {
    description: "Inspect and stop background terminals",
    handler: async (_args, ctx) => {
      while (true) {
        const records = required().list();
        if (!records.length) {
          ctx.ui.notify("No background terminals.", "info");
          return;
        }
        const labels = records.map(
          (record) => `${record.id} [${record.status}] ${record.title}`,
        );
        const choice = await ctx.ui.select("Background terminals", labels);
        if (!choice) return;
        const record = records[labels.indexOf(choice)];
        const actions =
          record.status === "running"
            ? ["view output", "kill", "refresh"]
            : ["view output", "refresh"];
        const action = await ctx.ui.select(
          `${record.id}: ${record.title}`,
          actions,
        );
        if (action === "view output")
          await ctx.ui.editor(
            `${record.id} · ${record.outputPath}`,
            recordText(record),
          );
        else if (action === "kill") {
          intentionalKills.add(record.id);
          await required().kill(record.id);
          ctx.ui.notify(`Stopped ${record.id}`, "info");
        } else if (!action) return;
      }
    },
  });
}

function summary(record: TerminalRecord) {
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    pid: record.pid,
    cwd: record.cwd,
    exitCode: record.exitCode,
    outputPath: record.outputPath,
  };
}
function recordText(record: TerminalRecord) {
  return sanitize(
    `${record.id} [${record.status}] "${record.title}"\nCommand: ${record.command}\nCWD: ${record.cwd}\nPID: ${record.pid ?? "unknown"}\nOutput: ${record.outputPath}${record.error ? `\nError: ${record.error}` : ""}\n\n${record.tail || "(no output yet)"}`,
  );
}
function completionText(record: TerminalRecord) {
  return sanitize(
    `Background terminal ${record.id} "${record.title}" finished with status ${record.status}${record.exitCode !== undefined ? ` (exit ${record.exitCode})` : ""}.\nFull output: ${record.outputPath}\n\n${record.tail || "(no output)"}`,
  );
}
function sanitize(value: string) {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}
