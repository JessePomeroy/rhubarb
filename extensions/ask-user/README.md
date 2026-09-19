# Ask user

`ask_user` asks exactly one question in an interactive popup. Its modes and
interaction design are inspired by Amos Blomqvist's
[ask-user-question extension](https://github.com/amosblomqvist/pi-config/blob/main/extensions/ask-user-question.ts),
implemented using this harness's Pi packages and existing tool name.

- **Free text:** omit `options` or pass an empty array. Enter submits a non-blank
  answer; Escape dismisses.
- **Single choice:** supply `options` with labels, optional descriptions, and
  optional stable `value` identifiers. Arrow keys navigate; Enter or 1–9 selects.
- **Multiple choices:** add `multiSelect: true`. Space or Enter toggles a choice.
  Navigate to **Submit** and press Enter when ready. At least one answer is required.
- **Other:** choice questions always include a custom-answer editor. In multiple
  choice mode, Enter edits it and Space removes it. Escape abandons an edit and
  returns to the choices without submitting.

Optional `details` appears beneath the question. Questions and descriptions wrap
with the terminal width, and selections appear as checkboxes in multi-select mode.
Recommended choices can be labeled `(Recommended)` and placed first.

Results include `status`, `mode`, and structured `answers` preserving labels,
values, answer types, and option indices. Existing `answer`, `options`,
`wasCustom`, and `cancelled` fields remain available. Dismissal and cancellation
never imply an answer or approval. Non-interactive mode returns `unavailable` and
asks the model to use plain text.

Question popups queue through `extensions/shared/ui-lock.ts`; future popup tools
can import the same lock to cooperate. Unrelated existing UI extensions have not
been migrated to this lock. Cancelled queued questions are skipped before opening.
Pi children remain unable to call `ask_user`; they use `ask_parent` instead.

After finishing active children, run `/reload` in Pi to load the update.

## Verification

Run `node --test --experimental-strip-types extensions/ask-user/ask-user.test.ts`
from the agent configuration directory, followed by `npm run check`.

For a live check, ask Pi:

> Use ask_user to demonstrate three questions, one at a time: a single-choice
> question with descriptions and context, a multi-select question where I can
> choose options and add an Other answer, and a free-text question. Then ask one
> final question that I will dismiss. Report the returned answers and confirm
> dismissal was not treated as approval. Do not change files.
