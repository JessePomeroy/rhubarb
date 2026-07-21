import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  getAgentDir,
  truncateHead,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runWorkflowAgent, type WorkflowAgentReport } from "./runner.ts";
import { runWorkflowSandbox } from "./sandbox.ts";
import { prepareWorkflowSource } from "./source.ts";

type WorkflowStatus = "running" | "completed" | "failed" | "aborted";
interface WorkflowRun {
  runId: string;
  sessionId: string;
  name?: string;
  description?: string;
  background: boolean;
  status: WorkflowStatus;
  startedAt: number;
  finishedAt?: number;
  phases: Array<{ title: string; detail?: string }>;
  currentPhase?: string;
  agents: WorkflowAgentReport[];
  result?: unknown;
  error?: string;
  runDir: string;
}

export default function workflowsExtension(pi: ExtensionAPI) {
  const runs = new Map<string, WorkflowRun>();
  const controllers = new Map<string, AbortController>();
  let sessionContext: ExtensionContext | undefined;

  pi.on("session_start", (_event, ctx) => {
    sessionContext = ctx;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== "workflow-run")
        continue;
      const runId = text(objectValue(entry.data).runId, 80);
      if (!runId || runs.has(runId)) continue;
      const loaded = loadRun(runId);
      if (loaded) runs.set(runId, loaded);
    }
    updateStatus(ctx, runs);
  });

  pi.on("session_shutdown", async () => {
    for (const controller of controllers.values())
      controller.abort(new Error("Parent session closed"));
    controllers.clear();
    sessionContext?.ui.setStatus("workflows", undefined);
    sessionContext = undefined;
  });

  pi.registerTool({
    name: "workflow",
    label: "Workflow",
    description: [
      "Use only when the user says ultracode or explicitly requests a workflow run.",
      "Run an inline JavaScript multi-agent workflow with phase(title), await agent(prompt, options), await parallel([thunks], { concurrency }), args, and a final return value.",
      "agent options: label, phase, schema, model, provider, effort. It always resolves to { ok, output, structured?, error? }; check ok before using results.",
      "Scripts cannot import modules or access filesystem, network, process, eval, or timers. Maximum 32 agent calls and four concurrent agents.",
    ].join(" "),
    promptSnippet:
      "Run an ultracode multi-agent workflow from sandboxed inline JavaScript",
    promptGuidelines: [
      "Use workflow only for explicit workflow requests or the keyword ultracode; use subagent_spawn for ordinary delegation.",
      "In workflow scripts, check every agent() result's ok field before consuming output or structured data.",
    ],
    parameters: Type.Object({
      script: Type.String({ minLength: 1, maxLength: 512 * 1024 }),
      args: Type.Optional(
        Type.String({ description: "JSON when valid, otherwise raw text" }),
      ),
      background: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      const source = prepareWorkflowSource(params.script);
      const args = parseArgs(params.args);
      const runId = `wf_${randomBytes(6).toString("hex")}`;
      const runDir = join(getAgentDir(), "workflows", runId);
      const background = (params.background ?? false) && ctx.hasUI;
      const run: WorkflowRun = {
        runId,
        sessionId: ctx.sessionManager.getSessionId(),
        background,
        status: "running",
        startedAt: Date.now(),
        phases: [],
        agents: [],
        runDir,
      };
      runs.set(runId, run);
      pi.appendEntry("workflow-run", { runId });
      mkdirSync(runDir, { recursive: true, mode: 0o700 });
      writePrivate(join(runDir, "script.js"), params.script);
      if (params.args !== undefined)
        writePrivate(join(runDir, "args.json"), params.args);
      persist(run);

      const controller = new AbortController();
      controllers.set(runId, controller);
      if (!background && signal) {
        if (signal.aborted) controller.abort(signal.reason);
        else
          signal.addEventListener(
            "abort",
            () => controller.abort(signal.reason),
            { once: true },
          );
      }
      const completion = executeRun(run, source, args, ctx, controller, () => {
        persist(run);
        updateStatus(ctx, runs);
        if (!background) {
          onUpdate?.({
            content: [{ type: "text", text: summary(run) }],
            details: compact(run),
          });
        }
      }).finally(() => controllers.delete(runId));

      if (background) {
        void completion.then(() => {
          pi.sendMessage(
            {
              customType: "workflow-result",
              content: report(run),
              display: true,
              details: compact(run),
            },
            { deliverAs: "followUp", triggerTurn: true },
          );
        });
        return {
          content: [
            {
              type: "text",
              text: `Started background workflow ${runId}. Artifacts: ${runDir}. Use /workflows to inspect it.`,
            },
          ],
          details: compact(run),
        };
      }

      await completion;
      if (run.status === "failed" || run.status === "aborted")
        throw new Error(report(run));
      return {
        content: [{ type: "text", text: bounded(report(run)) }],
        details: compact(run),
      };
    },
  });

  pi.registerCommand("workflows", {
    description: "Inspect workflow runs and artifacts",
    handler: async (args, ctx) => {
      const all = [...runs.values()].sort((a, b) => b.startedAt - a.startedAt);
      const requested = args.trim();
      let selected = requested
        ? all.find(
            (run) => run.runId === requested || run.runId.endsWith(requested),
          )
        : undefined;
      if (!selected) {
        if (!all.length) {
          ctx.ui.notify("No workflow runs in this session.", "info");
          return;
        }
        const labels = all.map(
          (run) =>
            `${run.runId} [${run.status}] ${run.name ?? "workflow"} · ${run.agents.length} agents`,
        );
        const choice = await ctx.ui.select("Workflow runs", labels);
        if (!choice) return;
        selected = all[labels.indexOf(choice)];
      }
      if (selected)
        await ctx.ui.editor(
          `${selected.runId} artifacts: ${selected.runDir}`,
          report(selected),
        );
    },
  });
}

async function executeRun(
  run: WorkflowRun,
  source: string,
  args: unknown,
  ctx: ExtensionContext,
  controller: AbortController,
  changed: () => void,
) {
  const limit = createLimiter(4);
  try {
    run.result = await runWorkflowSandbox({
      source,
      args,
      cwd: ctx.cwd,
      signal: controller.signal,
      onMeta(meta) {
        const value = objectValue(meta);
        run.name = text(value.name, 160);
        run.description = text(value.description, 2000);
        if (Array.isArray(value.phases)) {
          run.phases = value.phases.slice(0, 64).map((phase) => {
            const item = objectValue(phase);
            return {
              title: text(item.title, 160) ?? "phase",
              ...(text(item.detail, 2000)
                ? { detail: text(item.detail, 2000) }
                : {}),
            };
          });
        }
        changed();
      },
      onPhase(title) {
        run.currentPhase = title;
        if (!run.phases.some((phase) => phase.title === title))
          run.phases.push({ title });
        changed();
      },
      onAgent(prompt, options, signal) {
        return limit(async () => {
          const report = await runWorkflowAgent(ctx, prompt, options, signal);
          run.agents.push(report);
          changed();
          return report;
        });
      },
    });
    run.status = "completed";
  } catch (error) {
    run.status = controller.signal.aborted ? "aborted" : "failed";
    run.error = error instanceof Error ? error.message : String(error);
  } finally {
    run.finishedAt = Date.now();
    if (run.result !== undefined)
      writePrivate(join(run.runDir, "result.json"), safeJson(run.result));
    persist(run);
    changed();
  }
}

function persist(run: WorkflowRun) {
  const compactRun = {
    ...run,
    runDir: undefined,
    result: run.result === undefined ? undefined : "[result.json]",
    agents: run.agents.map((agent) => ({ ...agent, transcript: [] })),
  };
  writePrivate(join(run.runDir, "workflow.json"), safeJson(compactRun));
  writePrivate(
    join(run.runDir, "transcripts.json"),
    safeJson(
      Object.fromEntries(
        run.agents.map((agent, index) => [index, agent.transcript]),
      ),
    ),
  );
}
function loadRun(runId: string): WorkflowRun | undefined {
  const runDir = join(getAgentDir(), "workflows", runId);
  try {
    const stored = JSON.parse(
      readFileSync(join(runDir, "workflow.json"), "utf8"),
    ) as Omit<WorkflowRun, "runDir">;
    if (stored.runId !== runId || stored.status === "running") return undefined;
    return { ...stored, result: undefined, runDir };
  } catch {
    return undefined;
  }
}

function writePrivate(path: string, content: string) {
  writeFileSync(path, content, { encoding: "utf8", mode: 0o600 });
}
function safeJson(value: unknown) {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (_key, item) => {
      if (typeof item === "bigint") return `${item}n`;
      if (item && typeof item === "object") {
        if (seen.has(item)) return "[Circular]";
        seen.add(item);
      }
      return item;
    },
    2,
  );
}
function parseArgs(raw?: string) {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
function compact(run: WorkflowRun) {
  return {
    runId: run.runId,
    name: run.name,
    status: run.status,
    phase: run.currentPhase,
    agents: run.agents.map((agent) => ({
      label: agent.label,
      phase: agent.phase,
      ok: agent.ok,
    })),
  };
}
function summary(run: WorkflowRun) {
  return `${run.runId} [${run.status}] ${run.currentPhase ?? "starting"} · ${run.agents.filter((agent) => agent.ok).length}/${run.agents.length} agents ok`;
}
function report(run: WorkflowRun) {
  return `${summary(run)}\nArtifacts: ${run.runDir}${run.error ? `\nError: ${run.error}` : ""}${run.result !== undefined ? `\n\nResult:\n${safeJson(run.result)}` : ""}`;
}
function bounded(value: string) {
  const result = truncateHead(value, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });
  return result.truncated
    ? `${result.content}\n[output truncated; inspect artifacts]`
    : result.content;
}
function updateStatus(ctx: ExtensionContext, runs: Map<string, WorkflowRun>) {
  const running = [...runs.values()].filter(
    (run) => run.status === "running",
  ).length;
  ctx.ui.setStatus("workflows", running ? `workflows:${running}` : undefined);
}
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function text(value: unknown, max: number) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}
function createLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(operation: () => Promise<T>) => {
    if (active >= max)
      await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await operation();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
