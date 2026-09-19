export interface PaneFrame {
  type: "frame";
  title: string;
  status: string;
  lines: string[];
  questionId?: string;
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid pane message");
  return Object.fromEntries(Object.entries(value));
}

export function parseFrame(value: unknown): PaneFrame {
  const data = record(value);
  if (
    data.type !== "frame" ||
    typeof data.title !== "string" ||
    typeof data.status !== "string" ||
    !Array.isArray(data.lines) ||
    !data.lines.every((line): line is string => typeof line === "string") ||
    (data.questionId !== undefined && typeof data.questionId !== "string")
  )
    throw new Error("Invalid pane frame");
  return {
    type: "frame",
    title: data.title,
    status: data.status,
    lines: data.lines,
    questionId: data.questionId,
  };
}

export function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
