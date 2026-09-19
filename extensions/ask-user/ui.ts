import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  Key,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
  visibleWidth,
  type TUI,
} from "@earendil-works/pi-tui";
import type { AskUserInput } from "./index.ts";

export type Answer =
  | { type: "option"; label: string; value: string; index: number }
  | { type: "text" | "other"; label: string; value: string };

export function createQuestionUi(
  params: AskUserInput,
  tui: TUI,
  theme: Theme,
  done: (result: Answer[] | null) => void,
  signal?: AbortSignal,
) {
  const options = params.options ?? [];
  const textMode = options.length === 0;
  const multi = !textMode && !!params.multiSelect;
  const otherIndex = options.length;
  const submitIndex = options.length + 1;
  const count = options.length + (multi ? 2 : 1);
  const selected = new Map<number, Answer>();
  let cursor = 0;
  let editing = textMode;
  let settled = false;
  let focused = true;
  const editor = new Editor(tui, {
    borderColor: (s) => theme.fg("accent", s),
    selectList: {
      selectedPrefix: (s) => theme.fg("accent", s),
      selectedText: (s) => theme.fg("accent", s),
      description: (s) => theme.fg("muted", s),
      scrollInfo: (s) => theme.fg("dim", s),
      noMatch: (s) => theme.fg("warning", s),
    },
  });
  editor.focused = true;
  const refresh = () => {
    editor.focused = focused && editing;
    tui.requestRender();
  };
  const finish = (answer: Answer[] | null) => {
    if (settled) return;
    settled = true;
    signal?.removeEventListener("abort", cancel);
    done(answer);
  };
  const cancel = () => finish(null);
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) queueMicrotask(cancel);
  editor.onSubmit = (value) => {
    const label = value.trim();
    if (!label) return;
    const answer: Answer = {
      type: textMode ? "text" : "other",
      label,
      value: label,
    };
    if (multi) {
      selected.set(otherIndex, answer);
      editing = false;
      refresh();
    } else finish([answer]);
  };
  function choose(index: number, space = false) {
    cursor = index;
    if (multi && index === submitIndex) {
      if (!space && selected.size)
        finish(
          [...selected.entries()].sort(([a], [b]) => a - b).map(([, a]) => a),
        );
    } else if (index === otherIndex) {
      if (space && selected.has(index)) selected.delete(index);
      else {
        editing = true;
        editor.setText(selected.get(index)?.label ?? "");
      }
    } else {
      const option = options[index];
      const answer: Answer = {
        type: "option",
        label: option.label,
        value: option.value ?? option.label,
        index: index + 1,
      };
      if (!multi) finish([answer]);
      else if (selected.has(index)) selected.delete(index);
      else selected.set(index, answer);
    }
    refresh();
  }
  return {
    get focused() {
      return focused;
    },
    set focused(value: boolean) {
      focused = value;
      editor.focused = value && editing;
    },
    handleInput(data: string) {
      if (settled) return;
      if (editing) {
        if (matchesKey(data, Key.escape)) {
          if (textMode) finish(null);
          else {
            editing = false;
            refresh();
          }
        } else {
          editor.handleInput(data);
          refresh();
        }
        return;
      }
      if (matchesKey(data, Key.escape)) {
        finish(null);
        return;
      }
      if (matchesKey(data, Key.up)) cursor = Math.max(0, cursor - 1);
      else if (matchesKey(data, Key.down))
        cursor = Math.min(count - 1, cursor + 1);
      else if (matchesKey(data, Key.enter)) {
        choose(cursor);
        return;
      } else if (multi && matchesKey(data, Key.space)) {
        choose(cursor, true);
        return;
      } else if (/^[1-9]$/.test(data) && Number(data) <= options.length) {
        choose(Number(data) - 1);
        return;
      }
      refresh();
    },
    render(width: number) {
      // Recompute on every render: terminal resize does not always invalidate components.
      const lines: string[] = [];
      const add = (text: string) => lines.push(truncateToWidth(text, width));
      const wrapped = (text: string, indent = " ") => {
        for (const line of wrapTextWithAnsi(
          text,
          Math.max(1, width - indent.length),
        ))
          add(indent + line);
      };
      const heading = `─ Question · ${textMode ? "Text" : multi ? "Select multiple" : "Select one"} `;
      add(
        theme.fg(
          "accent",
          heading + "─".repeat(Math.max(0, width - visibleWidth(heading))),
        ),
      );
      wrapped(theme.bold(params.question));
      if (params.details) {
        lines.push("");
        wrapped(theme.fg("muted", params.details));
      }
      lines.push("");
      if (!textMode) {
        for (let i = 0; i < count; i++) {
          const option = options[i];
          const other = i === otherIndex;
          const submit = i === submitIndex;
          const label = submit
            ? `Submit (${selected.size} selected)`
            : other
              ? `Other${selected.get(i) ? ` — ${selected.get(i)?.label}` : " — write my own answer"}`
              : `${i + 1}. ${option.label}`;
          const marker =
            multi && !submit ? (selected.has(i) ? "[x] " : "[ ] ") : "";
          wrapped(
            theme.fg(
              i === cursor ? "accent" : selected.has(i) ? "success" : "text",
              marker + label,
            ),
            i === cursor ? " ❯ " : "   ",
          );
          if (option?.description)
            wrapped(theme.fg("muted", option.description), "      ");
        }
      }
      if (editing) {
        add(theme.fg("muted", textMode ? " Your answer:" : " Custom answer:"));
        for (const line of editor.render(Math.max(1, width - 2)))
          add(` ${line}`);
      }
      lines.push("");
      add(
        theme.fg(
          "dim",
          editing
            ? ` Enter ${multi ? "save" : "submit"} • Esc ${textMode ? "dismiss" : "back"}`
            : multi
              ? " ↑↓ navigate • Space toggle • Enter edit/submit • Esc dismiss"
              : " ↑↓ or 1–9 select • Enter confirm • Esc dismiss",
        ),
      );
      if (multi && !editing && !selected.size)
        add(
          theme.fg("muted", " Select at least one answer before submitting."),
        );
      add(theme.fg("accent", "─".repeat(Math.max(0, width))));
      return lines;
    },
    invalidate() {
      editor.invalidate();
    },
    dispose() {
      signal?.removeEventListener("abort", cancel);
    },
  };
}
