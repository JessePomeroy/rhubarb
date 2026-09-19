import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { withUiLock } from "../shared/ui-lock.ts";
import { createQuestionUi, type Answer } from "./ui.ts";
import {
  ASK_USER_PROMPT_GUIDELINES,
  ASK_USER_PROMPT_SNIPPET,
  ASK_USER_TOOL_DESCRIPTION,
} from "./prompt.ts";

const AskUserParams = Type.Object({
  question: Type.String({
    minLength: 1,
    description: "Exactly one question to ask",
  }),
  details: Type.Optional(
    Type.String({ description: "Context shown beneath the question" }),
  ),
  options: Type.Optional(
    Type.Array(
      Type.Object({
        label: Type.String({ minLength: 1 }),
        value: Type.Optional(
          Type.String({
            description: "Stable result value; defaults to label",
          }),
        ),
        description: Type.Optional(Type.String()),
      }),
      {
        description:
          "Choices; omit or use an empty array for free text. Other is added automatically.",
      },
    ),
  ),
  multiSelect: Type.Optional(
    Type.Boolean({
      description: "Allow multiple answers to the same question",
    }),
  ),
});
export type AskUserInput = Static<typeof AskUserParams>;

export function questionResult(
  params: AskUserInput,
  status: "answered" | "cancelled" | "unavailable",
  answers: Answer[] = [],
) {
  const mode = !params.options?.length
    ? "text"
    : params.multiSelect
      ? "multi-select"
      : "single-select";
  const text =
    status === "unavailable"
      ? "No interactive UI is available. Ask the user in plain text instead."
      : status === "cancelled"
        ? "User dismissed or cancelled the question without answering. Do not assume an answer or approval."
        : `User answered:\n${answers.map((answer) => (answer.type === "option" ? `${answer.index}. ${answer.label}` : answer.type === "other" ? `Other: ${answer.label}` : answer.label)).join("\n")}`;
  return {
    content: [{ type: "text" as const, text }],
    details: {
      question: params.question,
      context: params.details,
      mode,
      status,
      answers,
      // Retain the existing result fields for saved tool renderings and consumers.
      options: params.options?.map((o) => o.label) ?? [],
      answer:
        status === "answered" ? answers.map((a) => a.label).join("; ") : null,
      wasCustom: answers.some((a) => a.type !== "option"),
      cancelled: status !== "answered",
    },
  };
}

export default function askUser(pi: ExtensionAPI) {
  pi.registerTool<
    typeof AskUserParams,
    ReturnType<typeof questionResult>["details"]
  >({
    name: "ask_user",
    label: "Ask User",
    description: ASK_USER_TOOL_DESCRIPTION,
    promptSnippet: ASK_USER_PROMPT_SNIPPET,
    promptGuidelines: ASK_USER_PROMPT_GUIDELINES,
    parameters: AskUserParams,
    async execute(_id, params, signal, _update, ctx) {
      if (!params.question.trim())
        throw new Error("A non-empty question is required.");
      if (params.options?.some((option) => !option.label.trim()))
        throw new Error("Option labels must not be blank.");
      if (signal?.aborted) return questionResult(params, "cancelled");
      if (ctx.mode !== "tui") return questionResult(params, "unavailable");
      return withUiLock(async () => {
        // A queued question may have been cancelled while another popup was open.
        if (signal?.aborted) return questionResult(params, "cancelled");
        const answers = await ctx.ui.custom<Answer[] | null>(
          (tui, theme, _kb, done) =>
            createQuestionUi(params, tui, theme, done, signal),
        );
        return questionResult(
          params,
          answers === null ? "cancelled" : "answered",
          answers ?? [],
        );
      });
    },
    renderCall(args, theme) {
      const mode = !args.options?.length
        ? "text"
        : args.multiSelect
          ? "multi-select"
          : "single-select";
      return new Text(
        theme.fg("toolTitle", theme.bold("ask_user ")) +
          theme.fg("muted", args.question ?? "") +
          theme.fg("dim", ` [${mode}]`),
        0,
        0,
      );
    },
    renderResult(result, _options, theme) {
      const first = result.content[0];
      return new Text(
        theme.fg(
          result.details?.cancelled ? "warning" : "success",
          first?.type === "text" ? first.text : "",
        ),
        0,
        0,
      );
    },
  });
}
