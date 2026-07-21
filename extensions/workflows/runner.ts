import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  type AgentSession,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import type { WorkflowAgentResult } from "./sandbox.ts";

const FIRST_RESPONSE_TIMEOUT_MS = 45_000;
const TOOL_TIMEOUT_MS = 3 * 60_000;
const EXCLUDED_TOOLS = [
  "workflow",
  "subagent_spawn",
  "subagent_wait",
  "subagent_cancel",
  "subagent_check",
  "subagent_list",
  "ask_user",
];

export interface WorkflowAgentOptions extends Record<string, unknown> {
  label?: string;
  phase?: string;
  schema?: unknown;
  model?: string;
  provider?: string;
  effort?: string;
}

export interface WorkflowAgentReport extends WorkflowAgentResult {
  label: string;
  phase?: string;
  model?: string;
  startedAt: number;
  finishedAt: number;
  turns: number;
  transcript: Array<{
    role: string;
    text: string;
    name?: string;
    isError?: boolean;
  }>;
}

export async function runWorkflowAgent(
  ctx: ExtensionContext,
  prompt: string,
  options: WorkflowAgentOptions,
  signal: AbortSignal,
): Promise<WorkflowAgentReport> {
  const startedAt = Date.now();
  const transcript: WorkflowAgentReport["transcript"] = [
    { role: "user", text: prompt },
  ];
  const model = resolveModel(ctx, options.provider, options.model);
  let structured: unknown;
  let turns = 0;
  const customTools: ToolDefinition[] = [];

  if (options.schema !== undefined) {
    if (
      !options.schema ||
      typeof options.schema !== "object" ||
      Array.isArray(options.schema)
    ) {
      return failure("Structured output schema must be a JSON Schema object.");
    }
    customTools.push({
      name: "structured_output",
      label: "Structured Output",
      description:
        "Return the final structured workflow result. Call exactly once as the final action.",
      parameters: options.schema as TSchema,
      async execute(_id, params) {
        structured = params;
        return {
          content: [{ type: "text", text: "Structured result accepted." }],
          details: {},
          terminate: true,
        };
      },
    });
  }

  let session: AgentSession | undefined;
  let unsubscribe: (() => void) | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let firstResponse = false;

  try {
    const created = await createAgentSession({
      cwd: ctx.cwd,
      model,
      thinkingLevel: normalizeEffort(options.effort) ?? undefined,
      excludeTools: EXCLUDED_TOOLS,
      customTools,
    });
    session = created.session;
    await session.bindExtensions({ mode: "print" });
    installToolTimeouts(session);

    unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update" && !firstResponse) {
        firstResponse = true;
        if (watchdog) clearTimeout(watchdog);
      }
      if (event.type === "message_end") {
        if (event.message.role === "assistant") {
          turns++;
          for (const part of event.message.content) {
            if (part.type === "text")
              transcript.push({ role: "assistant", text: part.text });
            else if (part.type === "thinking")
              transcript.push({
                role: "thinking",
                text: part.redacted ? "[redacted]" : part.thinking,
              });
            else if (part.type === "toolCall")
              transcript.push({
                role: "tool",
                name: part.name,
                text: safeJson(part.arguments),
              });
          }
        } else if (event.message.role === "toolResult") {
          transcript.push({
            role: "toolResult",
            name: event.message.toolName,
            text: event.message.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n"),
            isError: event.message.isError,
          });
        }
      }
    });

    const timeout = new Promise<never>((_resolve, reject) => {
      watchdog = setTimeout(() => {
        const error = new Error(
          "Workflow agent produced no response within 45 seconds.",
        );
        void session?.abort();
        reject(error);
      }, FIRST_RESPONSE_TIMEOUT_MS);
    });
    const abort = new Promise<never>((_resolve, reject) => {
      if (signal.aborted)
        reject(signal.reason ?? new Error("Workflow agent aborted"));
      signal.addEventListener(
        "abort",
        () => {
          void session?.abort();
          reject(signal.reason ?? new Error("Workflow agent aborted"));
        },
        { once: true },
      );
    });

    const instruction =
      options.schema === undefined
        ? prompt
        : `${prompt}\n\nWhen complete, call structured_output exactly once as your final action. Do not write text after it.`;
    await Promise.race([session.prompt(instruction), timeout, abort]);
    if (watchdog) clearTimeout(watchdog);
    const last = lastAssistant(session);
    const output = finalText(session);
    if (last?.stopReason === "error")
      return failure(last.errorMessage ?? "Workflow agent failed.", output);
    if (options.schema !== undefined && structured === undefined) {
      return failure(
        "Agent finished without calling structured_output.",
        output,
      );
    }
    return {
      ok: true,
      output,
      ...(structured !== undefined ? { structured } : {}),
      label: label(options),
      phase: stringOption(options.phase),
      model: session.model
        ? `${session.model.provider}/${session.model.id}`
        : undefined,
      startedAt,
      finishedAt: Date.now(),
      turns,
      transcript,
    };
  } catch (error) {
    return failure(
      error instanceof Error ? error.message : String(error),
      session ? finalText(session) : "",
    );
  } finally {
    if (watchdog) clearTimeout(watchdog);
    unsubscribe?.();
    if (session) {
      await session.abort().catch(() => undefined);
      try {
        await session.extensionRunner.emit({
          type: "session_shutdown",
          reason: "quit",
        });
      } catch {}
      session.dispose();
    }
  }

  function failure(error: string, output = ""): WorkflowAgentReport {
    return {
      ok: false,
      output,
      error,
      label: label(options),
      phase: stringOption(options.phase),
      model: model ? `${model.provider}/${model.id}` : undefined,
      startedAt,
      finishedAt: Date.now(),
      turns,
      transcript,
    };
  }
}

function resolveModel(
  ctx: ExtensionContext,
  provider?: unknown,
  model?: unknown,
): Model<any> | undefined {
  const providerName = stringOption(provider);
  const modelName = stringOption(model);
  if (!providerName && !modelName) return ctx.model;
  if (modelName?.includes("/") && !providerName) {
    const slash = modelName.indexOf("/");
    const found = ctx.modelRegistry.find(
      modelName.slice(0, slash),
      modelName.slice(slash + 1),
    );
    if (!found) throw new Error(`Unknown workflow model: ${modelName}`);
    return found;
  }
  const effectiveProvider = providerName ?? ctx.model?.provider;
  const effectiveModel = modelName ?? ctx.model?.id;
  if (!effectiveProvider || !effectiveModel)
    throw new Error("Workflow model could not be resolved.");
  const found = ctx.modelRegistry.find(effectiveProvider, effectiveModel);
  if (!found)
    throw new Error(
      `Unknown workflow model: ${effectiveProvider}/${effectiveModel}`,
    );
  return found;
}

function installToolTimeouts(session: AgentSession) {
  for (const { name } of session.getAllTools()) {
    const definition = session.getToolDefinition(name);
    if (
      !definition ||
      (definition as ToolDefinition & { __rhubarbTimeout?: boolean })
        .__rhubarbTimeout
    )
      continue;
    const original = definition.execute;
    (
      definition as ToolDefinition & { __rhubarbTimeout?: boolean }
    ).__rhubarbTimeout = true;
    definition.execute = async (id, params, signal, onUpdate, ctx) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutController = new AbortController();
      const executionSignal = signal
        ? AbortSignal.any([signal, timeoutController.signal])
        : timeoutController.signal;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error(
            `Tool ${definition.name} timed out after 3 minutes.`,
          );
          timeoutController.abort(error);
          reject(error);
        }, TOOL_TIMEOUT_MS);
      });
      try {
        return await Promise.race([
          original.call(definition, id, params, executionSignal, onUpdate, ctx),
          timeout,
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
  }
}

function normalizeEffort(value: unknown) {
  const effort = stringOption(value);
  return effort === "off" ||
    effort === "minimal" ||
    effort === "low" ||
    effort === "medium" ||
    effort === "high" ||
    effort === "xhigh" ||
    effort === "max"
    ? effort
    : undefined;
}
function label(options: WorkflowAgentOptions) {
  return stringOption(options.label) ?? "agent";
}
function stringOption(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}
function lastAssistant(session: AgentSession) {
  for (let i = session.messages.length - 1; i >= 0; i--)
    if (session.messages[i].role === "assistant")
      return session.messages[i] as AssistantMessage;
  return undefined;
}
function finalText(session: AgentSession) {
  return (
    lastAssistant(session)
      ?.content.filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim() ?? ""
  );
}
