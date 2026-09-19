import assert from "node:assert/strict";
import test from "node:test";
import { TUI, visibleWidth, type Terminal } from "@earendil-works/pi-tui";
import { getThemeByName } from "../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js";
import { createQuestionUi, type Answer } from "./ui.ts";
import { questionResult, type AskUserInput } from "./index.ts";
import { createUiLock } from "../shared/ui-lock.ts";

function question(params: AskUserInput, signal?: AbortSignal) {
  const terminal: Terminal = {
    columns: 100,
    rows: 40,
    kittyProtocolActive: false,
    start() {},
    stop() {},
    async drainInput() {},
    write() {},
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
  };
  const tui = new TUI(terminal);
  const theme = getThemeByName("dark");
  assert.ok(theme);
  const results: Array<Answer[] | null> = [];
  const ui = createQuestionUi(
    params,
    tui,
    theme,
    (value) => results.push(value),
    signal,
  );
  return { ui, results };
}
const options = [
  {
    label: "First",
    value: "first",
    description:
      "A detailed option description that should wrap in a narrow pane.",
  },
  { label: "Second", value: "second" },
];
const down = "\x1b[B";
const enter = "\r";
const escape = "\x1b";

test("single selection retains stable values and custom answers", () => {
  const first = question({ question: "Choose", options });
  first.ui.handleInput("2");
  assert.deepEqual(first.results, [
    [{ type: "option", label: "Second", value: "second", index: 2 }],
  ]);
  const other = question({ question: "Choose", options });
  other.ui.handleInput(down);
  other.ui.handleInput(down);
  other.ui.handleInput(enter);
  other.ui.handleInput("My choice");
  other.ui.handleInput(enter);
  assert.deepEqual(other.results, [
    [{ type: "other", label: "My choice", value: "My choice" }],
  ]);
});

test("free text rejects blank submissions and Escape dismisses", () => {
  const { ui, results } = question({ question: "What do you need?" });
  ui.handleInput(enter);
  assert.equal(results.length, 0);
  ui.handleInput("A dashboard");
  ui.handleInput(enter);
  assert.deepEqual(results, [
    [{ type: "text", label: "A dashboard", value: "A dashboard" }],
  ]);
  const dismissed = question({ question: "Anything else?", options: [] });
  dismissed.ui.handleInput(escape);
  assert.deepEqual(dismissed.results, [null]);
});

test("multi-select waits for Submit, sorts choices, and supports editable/removable Other", () => {
  const { ui, results } = question({
    question: "Which features?",
    options,
    multiSelect: true,
  });
  ui.handleInput(down);
  ui.handleInput(down);
  ui.handleInput(down);
  ui.handleInput(enter);
  assert.equal(results.length, 0, "empty selection is not submitted");
  ui.handleInput("2");
  ui.handleInput("1");
  assert.equal(results.length, 0, "toggling does not submit");
  ui.handleInput(down);
  ui.handleInput(down);
  ui.handleInput(enter);
  ui.handleInput("Custom");
  ui.handleInput(enter);
  assert.match(ui.render(100).join("\n"), /Custom/);
  ui.handleInput(" "); // Remove custom answer.
  assert.doesNotMatch(ui.render(100).join("\n"), /Other — Custom/);
  ui.handleInput(enter);
  ui.handleInput("Replacement");
  ui.handleInput(enter);
  ui.handleInput(down);
  ui.handleInput(enter);
  assert.deepEqual(results, [
    [
      { type: "option", label: "First", value: "first", index: 1 },
      { type: "option", label: "Second", value: "second", index: 2 },
      { type: "other", label: "Replacement", value: "Replacement" },
    ],
  ]);
});

test("Escape abandons an edit before dismissing; abort settles only once", () => {
  const controller = new AbortController();
  const { ui, results } = question(
    { question: "Choose", options, multiSelect: true },
    controller.signal,
  );
  ui.handleInput("1");
  ui.handleInput(down);
  ui.handleInput(down);
  ui.handleInput(enter);
  ui.handleInput("Draft");
  ui.handleInput(escape);
  assert.equal(results.length, 0);
  controller.abort();
  ui.handleInput(escape);
  assert.deepEqual(results, [null]);
});

test("question, context, descriptions, and editor fit after a terminal resize", () => {
  for (const mode of [{}, { options }, { options, multiSelect: true }]) {
    const { ui } = question({
      question: "A long question with unicode 日本語 and emoji 🐕",
      details: "Context that explains this decision and wraps across lines.",
      ...mode,
    });
    for (const width of [100, 32, 12, 80]) {
      const lines = ui.render(width);
      assert.ok(lines.every((line) => visibleWidth(line) <= width));
    }
    ui.dispose();
  }
});

test("results distinguish unavailable/cancelled and preserve all selected values", () => {
  const params = { question: "Choose", options, multiSelect: true };
  const cancelled = questionResult(params, "cancelled");
  assert.match(
    cancelled.content[0].text,
    /Do not assume an answer or approval/,
  );
  assert.equal(cancelled.details.answer, null);
  assert.equal(
    questionResult(params, "unavailable").details.status,
    "unavailable",
  );
  const result = questionResult(params, "answered", [
    { type: "option", label: "First", value: "first", index: 1 },
  ]);
  assert.equal(result.details.answers[0].value, "first");
  assert.equal(result.details.mode, "multi-select");
});

test("popup queue serializes callers and releases after failure", async () => {
  const lock = createUiLock();
  const order: number[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = lock(async () => {
    order.push(1);
    await gate;
    throw new Error("UI failure");
  });
  const rejected = assert.rejects(first, /UI failure/);
  const second = lock(async () => {
    order.push(2);
  });
  await Promise.resolve();
  assert.deepEqual(order, [1]);
  release();
  await rejected;
  await second;
  assert.deepEqual(order, [1, 2]);
});
