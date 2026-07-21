import { StringEnum } from "@earendil-works/pi-ai";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { createCodexBackend } from "./codex-backend.ts";
import { SubagentManager, type Harness, type RunRecord } from "./manager.ts";
import { createPiBackend } from "./pi-backend.ts";

const EFFORTS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export default function subagentsExtension(pi: ExtensionAPI) {
  let manager: SubagentManager | undefined;
  let context: ExtensionContext | undefined;
  let unsubscribe: (() => void) | undefined;

  const requireManager = () => {
    if (!manager) throw new Error("Subagent manager is not ready.");
    return manager;
  };

  pi.on("session_start", (_event, ctx) => {
    context = ctx;
    manager = new SubagentManager({
      maxRunning: 4,
      maxTracked: 64,
      factories: {
        pi: createPiBackend({
          parent: ctx,
          thinkingLevel: () => pi.getThinkingLevel(),
        }),
        codex: createCodexBackend,
      },
      onSettled(record, consumed) {
        if (consumed) return;
        const text = resultText(record);
        pi.sendMessage(
          {
            customType: "subagent-result",
            content: text,
            display: true,
            details: {
              id: record.id,
              title: record.title,
              status: record.status,
            },
          },
          { deliverAs: "followUp", triggerTurn: true },
        );
      },
    });
    unsubscribe = manager.subscribe(() => {
      const running = manager?.runningCount() ?? 0;
      ctx.ui.setStatus(
        "subagents",
        running ? `subagents:${running}` : undefined,
      );
    });
  });

  pi.on("session_shutdown", async () => {
    unsubscribe?.();
    unsubscribe = undefined;
    context?.ui.setStatus("subagents", undefined);
    await manager?.dispose();
    manager = undefined;
    context = undefined;
  });

  pi.registerTool({
    name: "subagent_spawn",
    label: "Spawn Subagent",
    description:
      "Start an asynchronous pi or Codex subagent with an isolated context. The child has normal coding tools but cannot recursively orchestrate agents or workflows.",
    promptSnippet: "Start an asynchronous pi or Codex subagent",
    promptGuidelines: [
      "Give subagent_spawn a self-contained prompt with paths, constraints, and the expected report; continue useful parent work while it runs.",
    ],
    parameters: Type.Object({
      prompt: Type.String({ minLength: 1 }),
      name: Type.String({ minLength: 1, maxLength: 160 }),
      harness: StringEnum(["pi", "codex"] as const),
      working_dir: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()),
      reasoning_effort: Type.Optional(StringEnum(EFFORTS)),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const cwd = resolve(ctx.cwd, params.working_dir ?? ".");
      if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
        throw new Error(`working_dir is not a directory: ${cwd}`);
      }
      const record = await requireManager().spawn({
        prompt: params.prompt,
        title: params.name.trim(),
        harness: params.harness as Harness,
        cwd,
        model: params.model,
        reasoningEffort: params.reasoning_effort,
      });
      return {
        content: [
          {
            type: "text",
            text: `Started ${record.id} "${record.title}" with ${record.harness} in ${cwd}.`,
          },
        ],
        details: summary(record),
      };
    },
  });

  pi.registerTool({
    name: "subagent_check",
    label: "Check Subagent",
    description: "Inspect one subagent without waiting for it to finish.",
    parameters: Type.Object({ id: Type.String() }),
    async execute(_id, params) {
      const record = requireManager().get(params.id);
      if (!record) throw new Error(`Unknown subagent id: ${params.id}`);
      return {
        content: [{ type: "text", text: previewText(record) }],
        details: summary(record),
      };
    },
  });

  pi.registerTool({
    name: "subagent_list",
    label: "List Subagents",
    description: "List tracked subagents and their current status.",
    parameters: Type.Object({}),
    async execute() {
      const records = requireManager().list();
      return {
        content: [
          {
            type: "text",
            text: records.length
              ? records
                  .map(
                    (record) =>
                      `${record.id} [${record.status}] ${record.harness} "${record.title}"`,
                  )
                  .join("\n")
              : "No subagents.",
          },
        ],
        details: { subagents: records.map(summary) },
      };
    },
  });

  pi.registerTool({
    name: "subagent_wait",
    label: "Wait for Subagents",
    description:
      "Wait for specified subagents. Aborting this wait leaves the children running.",
    parameters: Type.Object({
      ids: Type.Array(Type.String(), { minItems: 1, maxItems: 64 }),
    }),
    async execute(_id, params, signal, onUpdate) {
      const records = await requireManager().wait(
        params.ids,
        signal,
        (pending) => {
          onUpdate?.({
            content: [
              { type: "text", text: `Waiting for ${pending.join(", ")}...` },
            ],
            details: { pending },
          });
        },
      );
      return {
        content: [
          {
            type: "text",
            text: bounded(records.map(resultText).join("\n\n---\n\n")),
          },
        ],
        details: { results: records.map(summary) },
      };
    },
  });

  pi.registerTool({
    name: "subagent_cancel",
    label: "Cancel Subagents",
    description: "Cancel one or more running subagents.",
    parameters: Type.Object({
      ids: Type.Array(Type.String(), { minItems: 1, maxItems: 64 }),
    }),
    async execute(_id, params) {
      const records = await requireManager().cancel(params.ids);
      return {
        content: [
          {
            type: "text",
            text: records
              .map((record) => `${record.id}: ${record.status}`)
              .join("\n"),
          },
        ],
        details: { results: records.map(summary) },
      };
    },
  });

  pi.registerCommand("btw", {
    description: "Start a pi side-question subagent",
    handler: async (args, ctx) => {
      const prompt =
        args.trim() || (await ctx.ui.editor("Ask a side question", ""));
      if (!prompt?.trim()) return;
      const record = await requireManager().spawn({
        prompt,
        title: prompt.trim().split(/\s+/).slice(0, 8).join(" "),
        harness: "pi",
        cwd: ctx.cwd,
      });
      ctx.ui.notify(`Started ${record.id}`, "info");
    },
  });

  pi.registerCommand("subagents", {
    description: "Inspect, steer, or cancel subagents",
    handler: async (_args, ctx) => {
      while (true) {
        const records = requireManager().list();
        if (records.length === 0) {
          ctx.ui.notify("No subagents.", "info");
          return;
        }
        const selected = await ctx.ui.select(
          "Subagents (choose one, or Esc to close)",
          records.map(
            (record) =>
              `${record.id} [${record.status}] ${record.harness} · ${record.title}`,
          ),
        );
        if (!selected) return;
        const id = selected.split(" ", 1)[0];
        const record = requireManager().get(id);
        if (!record) continue;
        const actions =
          record.status === "running"
            ? ["view", "steer", "cancel", "refresh"]
            : ["view", "refresh"];
        const action = await ctx.ui.select(
          `${record.id}: ${record.title}`,
          actions,
        );
        if (action === "view") {
          await ctx.ui.editor("Subagent transcript", previewText(record));
        } else if (action === "steer") {
          const message = await ctx.ui.editor("Steer subagent", "");
          if (message?.trim()) await requireManager().send(id, message);
        } else if (action === "cancel") {
          await requireManager().cancel([id]);
          ctx.ui.notify(`Cancelled ${id}`, "info");
        } else if (!action) {
          return;
        }
      }
    },
  });

  pi.registerMessageRenderer("subagent-result", (message, _options, theme) => {
    const details = message.details as
      { id?: string; title?: string; status?: string } | undefined;
    const failed =
      details?.status === "error" || details?.status === "cancelled";
    const icon = failed ? theme.fg("error", "x") : theme.fg("success", "■");
    return new Text(
      `${icon} ${theme.fg("accent", theme.bold(details?.id ?? "subagent"))} ${theme.fg("muted", details?.title ?? "")}\n${message.content}`,
      0,
      0,
    );
  });
}

function summary(record: RunRecord) {
  return {
    id: record.id,
    title: record.title,
    harness: record.harness,
    status: record.status,
    cwd: record.cwd,
    model: record.model,
    turns: record.turns,
  };
}

function previewText(record: RunRecord) {
  const output = record.status === "running" ? record.liveText : record.output;
  return bounded(
    `${record.id} [${record.status}] ${record.harness} "${record.title}"\nCWD: ${record.cwd}\nTurns: ${record.turns}` +
      (record.error ? `\nError: ${record.error}` : "") +
      `\n\n${output || "(no output yet)"}`,
    8 * 1024,
    80,
  );
}

function resultText(record: RunRecord) {
  return bounded(
    `## ${record.id} "${record.title}" [${record.status}]\n\n` +
      (record.error ? `Error: ${record.error}\n\n` : "") +
      (record.output || "(no output)"),
  );
}

function bounded(
  text: string,
  maxBytes = DEFAULT_MAX_BYTES,
  maxLines = DEFAULT_MAX_LINES,
) {
  const result = truncateHead(text, { maxBytes, maxLines });
  return result.truncated
    ? `${result.content}\n\n[output truncated]`
    : result.content;
}
