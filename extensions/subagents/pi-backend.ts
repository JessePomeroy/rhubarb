import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  type AgentSession,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { BackendFactory } from "./manager.ts";

const EXCLUDED_TOOLS = [
  "subagent_spawn",
  "subagent_wait",
  "subagent_cancel",
  "subagent_check",
  "subagent_list",
  "workflow_run",
  "ask_user",
];

type SessionOptions = NonNullable<Parameters<typeof createAgentSession>[0]>;
type ThinkingLevel = SessionOptions["thinkingLevel"];

interface PiBackendOptions {
  parent: ExtensionContext;
  thinkingLevel: () => ThinkingLevel;
}

export function createPiBackend(options: PiBackendOptions): BackendFactory {
  return async (request, callbacks) => {
    const model = resolveModel(options.parent, request.model);
    const { session } = await createAgentSession({
      cwd: request.cwd,
      model,
      thinkingLevel:
        (request.reasoningEffort as ThinkingLevel) ?? options.thinkingLevel(),
      excludeTools: EXCLUDED_TOOLS,
    });

    await session.bindExtensions({ mode: "print" });
    let closed = false;
    let settled = false;

    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update") {
        const update = event.assistantMessageEvent;
        if (update.type === "text_delta") callbacks.text(update.delta);
      }
      if (event.type === "message_end" && event.message.role === "assistant") {
        callbacks.turn();
      }
      if (event.type === "agent_settled")
        finishFromSession(session, callbacks, () => {
          settled = true;
        });
    });

    void session.prompt(request.prompt).catch((error) => {
      if (settled || closed) return;
      settled = true;
      callbacks.settled({
        status: "error",
        output: finalText(session),
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return {
      async send(text) {
        if (closed) throw new Error("Subagent session is closed.");
        if (!session.isStreaming) {
          throw new Error(
            "This subagent has already settled; spawn a new run to continue.",
          );
        }
        await session.steer(text);
      },
      async cancel() {
        if (closed || settled) return;
        session.clearQueue();
        await session.abort().catch(() => undefined);
        if (!settled) {
          settled = true;
          callbacks.settled({
            status: "cancelled",
            output: finalText(session),
          });
        }
      },
      async dispose() {
        if (closed) return;
        closed = true;
        unsubscribe();
        await session.abort().catch(() => undefined);
        try {
          await session.extensionRunner.emit({
            type: "session_shutdown",
            reason: "quit",
          });
        } catch {
          // Best effort during teardown.
        }
        session.dispose();
      },
    };
  };
}

function resolveModel(
  ctx: ExtensionContext,
  hint?: string,
): Model<any> | undefined {
  if (!hint) return ctx.model;
  const slash = hint.indexOf("/");
  if (slash > 0) {
    const model = ctx.modelRegistry.find(
      hint.slice(0, slash),
      hint.slice(slash + 1),
    );
    if (!model) throw new Error(`Unknown pi model: ${hint}`);
    return model;
  }
  const inherited = ctx.model
    ? ctx.modelRegistry.find(ctx.model.provider, hint)
    : undefined;
  if (inherited) return inherited;
  const matches = ctx.modelRegistry
    .getAll()
    .filter((model) => model.id === hint);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1)
    throw new Error(`Ambiguous pi model ${hint}; use provider/model.`);
  throw new Error(`Unknown pi model: ${hint}`);
}

function finishFromSession(
  session: AgentSession,
  callbacks: Parameters<BackendFactory>[1],
  markSettled: () => void,
) {
  const last = lastAssistant(session);
  markSettled();
  if (last?.stopReason === "aborted") {
    callbacks.settled({ status: "cancelled", output: finalText(session) });
  } else if (last?.stopReason === "error") {
    callbacks.settled({
      status: "error",
      output: finalText(session),
      error: last.errorMessage ?? "Pi subagent failed.",
    });
  } else {
    callbacks.settled({ status: "done", output: finalText(session) });
  }
}

function lastAssistant(session: AgentSession) {
  for (let index = session.messages.length - 1; index >= 0; index--) {
    const message = session.messages[index];
    if (message.role === "assistant") return message as AssistantMessage;
  }
  return undefined;
}

function finalText(session: AgentSession) {
  const message = lastAssistant(session);
  return (
    message?.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim() ?? ""
  );
}
