import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import type { ParentQuestion } from "./domain.ts";

/** A child waits in its tool call; only a matching reply or cancellation releases it. */
export function createParentChannel(
  onChange: (question?: ParentQuestion) => void,
) {
  let sequence = 0;
  const channelId = randomUUID();
  let closed = false;
  let pending:
    | {
        question: ParentQuestion;
        finish: (reply?: string, error?: Error) => void;
      }
    | undefined;

  return {
    request(question: string, signal?: AbortSignal): Promise<string> {
      if (closed) return Promise.reject(new Error("Parent channel is closed."));
      if (pending)
        return Promise.reject(
          new Error("A parent question is already awaiting a reply."),
        );
      if (!question.trim())
        return Promise.reject(new Error("Provide a nonempty question."));
      signal?.throwIfAborted();
      return new Promise((resolve, reject) => {
        const request = {
          id: `q-${channelId}-${++sequence}`,
          question: question.trim(),
        };
        const abort = () =>
          finish(undefined, new Error("Parent question cancelled."));
        const finish = (reply?: string, error?: Error) => {
          if (pending?.question !== request) return;
          pending = undefined;
          signal?.removeEventListener("abort", abort);
          onChange(undefined);
          if (error) reject(error);
          else resolve(reply ?? "");
        };
        pending = { question: request, finish };
        signal?.addEventListener("abort", abort, { once: true });
        onChange(request);
      });
    },
    get pending() {
      return pending?.question;
    },
    reply(id: string, text: string) {
      if (!pending || pending.question.id !== id)
        throw new Error(`Question ${id} is no longer awaiting a reply.`);
      if (!text.trim()) throw new Error("Provide a nonempty reply.");
      pending.finish(text);
    },
    close() {
      closed = true;
      pending?.finish(undefined, new Error("Parent session closed."));
    },
  };
}

export function parentQuestionTool(
  channel: ReturnType<typeof createParentChannel>,
) {
  return {
    name: "ask_parent",
    label: "Ask Parent Agent",
    description:
      "Ask the parent agent one necessary clarification and wait for its reply. Use when the assigned task is blocked by a missing decision. This contacts the parent, not the human. It does not authorize expanding scope or taking external actions.",
    parameters: Type.Object({ question: Type.String({ minLength: 1 }) }),
    async execute(
      _id: string,
      params: { question: string },
      signal?: AbortSignal,
    ) {
      const reply = await channel.request(params.question, signal);
      return { content: [{ type: "text" as const, text: reply }], details: {} };
    },
  };
}
