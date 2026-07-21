import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface QuestionOption {
  label: string;
  description?: string;
}

export type AskOutcome =
  | { kind: "no-ui" }
  | { kind: "cancelled" }
  | { kind: "dismissed" }
  | { kind: "custom"; answer: string }
  | { kind: "selected"; answer: string; index: number };

const CUSTOM_ANSWER = "Write my own answer…";

export default function askUserExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description:
      "Ask the user one multiple-choice question with 2-5 options. A free-form custom-answer option is appended automatically, and the user may dismiss without answering.",
    promptSnippet:
      "Ask the user one multiple-choice question with a free-form fallback",
    promptGuidelines: [
      "Use ask_user when likely answers can be enumerated instead of asking in plain text.",
      "Ask exactly one question per ask_user call; ask follow-up questions in later calls.",
    ],
    parameters: Type.Object({
      question: Type.String({ minLength: 1, maxLength: 1000 }),
      options: Type.Array(
        Type.Object({
          label: Type.String({ minLength: 1, maxLength: 160 }),
          description: Type.Optional(Type.String({ maxLength: 500 })),
        }),
        { minItems: 2, maxItems: 5 },
      ),
    }),
    async execute(_id, params, signal, _update, ctx) {
      if (!ctx.hasUI) return result({ kind: "no-ui" });

      const choices = params.options.map((option, index) =>
        formatOption(option, index),
      );
      choices.push(CUSTOM_ANSWER);
      const selected = await ctx.ui.select(params.question, choices, {
        signal,
      });

      if (signal?.aborted) return result({ kind: "cancelled" });
      if (selected === undefined) return result({ kind: "dismissed" });
      if (selected === CUSTOM_ANSWER) {
        const answer = await ctx.ui.input("Your answer", "Type a response", {
          signal,
        });
        if (signal?.aborted) return result({ kind: "cancelled" });
        if (answer === undefined || !answer.trim()) {
          return result({ kind: "dismissed" });
        }
        return result({ kind: "custom", answer: answer.trim() });
      }

      const index = choices.indexOf(selected);
      const option = params.options[index];
      if (!option) return result({ kind: "dismissed" });
      return result({
        kind: "selected",
        answer: option.label,
        index: index + 1,
      });
    },
  });
}

function formatOption(option: QuestionOption, index: number) {
  const label = `${index + 1}. ${option.label}`;
  return option.description ? `${label} — ${option.description}` : label;
}

export function outcomeText(outcome: AskOutcome) {
  switch (outcome.kind) {
    case "no-ui":
      return "No interactive UI is available. Ask the user in plain text instead.";
    case "cancelled":
      return "The question was cancelled.";
    case "dismissed":
      return "The user dismissed the question without answering. Do not assume an answer; proceed accordingly or ask differently.";
    case "custom":
      return `The user wrote their own answer: ${outcome.answer}`;
    case "selected":
      return `The user selected option ${outcome.index}: ${outcome.answer}`;
  }
}

function result(outcome: AskOutcome) {
  return {
    content: [{ type: "text" as const, text: outcomeText(outcome) }],
    details: outcome,
  };
}
