import type { Usage } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { addModelUsage, hasModelUsage } from "../shared/model-usage.ts";
import {
  CHILD_USAGE_CHANGED_CHANNEL,
  latestChildUsageRecords,
  type ChildUsageKind,
} from "../shared/usage-ledger.ts";

const CHILD_RESULT_TOOLS = new Set([
  "subagent_wait",
  "subagent_cancel",
  "workflow",
]);

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function formatTokens(value: number) {
  if (value < 1_000) return `${Math.round(value)}`;
  if (value < 1_000_000)
    return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

function tokenTotal(usage: Usage) {
  return (
    usage.totalTokens ||
    usage.input + usage.output + usage.cacheRead + usage.cacheWrite
  );
}

function usageLine(label: string, usage: Usage) {
  const reasoning = usage.reasoning ?? 0;
  return `${label}: ${formatNumber(tokenTotal(usage))} tokens · ${formatNumber(usage.input)} input · ${formatNumber(usage.output)} output · ${formatNumber(usage.cacheRead)} cache read · ${formatNumber(usage.cacheWrite)} cache write · ${formatNumber(reasoning)} reasoning · $${usage.cost.total.toFixed(4)}`;
}

function parentUsage(entries: ReadonlyArray<SessionEntry>) {
  const usage: Usage[] = [];
  for (const entry of entries) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      usage.push(entry.message.usage);
    } else if (
      entry.type === "message" &&
      entry.message.role === "toolResult" &&
      entry.message.usage &&
      !CHILD_RESULT_TOOLS.has(entry.message.toolName)
    ) {
      usage.push(entry.message.usage);
    } else if (
      (entry.type === "compaction" || entry.type === "branch_summary") &&
      entry.usage
    ) {
      usage.push(entry.usage);
    }
  }
  return addModelUsage(...usage);
}

function usageByKind(
  entries: ReadonlyArray<SessionEntry>,
  kind: ChildUsageKind,
) {
  return addModelUsage(
    ...[...latestChildUsageRecords(entries).values()]
      .filter((record) => record.kind === kind)
      .map((record) => record.usage),
  );
}

function modelBreakdown(entries: ReadonlyArray<SessionEntry>) {
  const byModel = new Map<string, Usage>();
  const add = (model: string, usage: Usage) => {
    byModel.set(model, addModelUsage(byModel.get(model), usage));
  };
  for (const entry of entries) {
    if (entry.type === "message" && entry.message.role === "assistant") {
      add(
        `${entry.message.provider}/${entry.message.responseModel ?? entry.message.model}`,
        entry.message.usage,
      );
    }
  }
  for (const record of latestChildUsageRecords(entries).values()) {
    add(
      record.model ?? `${record.backend ?? record.kind}/unknown`,
      record.usage,
    );
  }
  return [...byModel]
    .filter(([, usage]) => hasModelUsage(usage))
    .sort(
      ([, a], [, b]) =>
        b.cost.total - a.cost.total || tokenTotal(b) - tokenTotal(a),
    );
}

export default function usageTracking(pi: ExtensionAPI) {
  let currentContext: ExtensionContext | undefined;

  const refreshStatus = () => {
    const ctx = currentContext;
    if (!ctx?.hasUI) return;
    const entries = ctx.sessionManager.getBranch();
    const child = addModelUsage(
      usageByKind(entries, "subagent"),
      usageByKind(entries, "workflow"),
    );
    if (!hasModelUsage(child)) {
      ctx.ui.setStatus("child-usage", undefined);
      return;
    }
    ctx.ui.setStatus(
      "child-usage",
      ctx.ui.theme.fg(
        "dim",
        `child usage · ${formatTokens(tokenTotal(child))} tok · $${child.cost.total.toFixed(2)}`,
      ),
    );
  };

  const stopUsageListener = pi.events.on(
    CHILD_USAGE_CHANGED_CHANNEL,
    refreshStatus,
  );

  pi.on("session_start", (_event, ctx) => {
    currentContext = ctx;
    refreshStatus();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    stopUsageListener();
    ctx.ui.setStatus("child-usage", undefined);
    currentContext = undefined;
  });

  pi.registerCommand("usage", {
    description: "Show parent and child model usage for this session",
    handler: async (_args, ctx) => {
      const entries = ctx.sessionManager.getBranch();
      const parent = parentUsage(entries);
      const subagents = usageByKind(entries, "subagent");
      const workflows = usageByKind(entries, "workflow");
      const combined = addModelUsage(parent, subagents, workflows);
      const lines = [
        usageLine("Parent", parent),
        usageLine("Subagents", subagents),
        usageLine("Workflows", workflows),
        usageLine("Combined", combined),
      ];
      const models = modelBreakdown(entries);
      if (models.length > 0) {
        lines.push("", "By model:");
        for (const [model, usage] of models) {
          lines.push(
            `  ${model}: ${formatNumber(tokenTotal(usage))} tokens · $${usage.cost.total.toFixed(4)}`,
          );
        }
      }
      lines.push(
        "",
        "Reasoning is a subset of output. OpenAI account limits are not included in these local totals.",
      );
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}

export const usageTrackingInternals = {
  parentUsage,
  usageByKind,
};
