# Subagent communication and Herdr panes

The existing Pi, Claude, and Codex backends remain in place. Parent agents can now send messages, and Pi children can ask their parent a question and wait for a reply. Nested delegation remains disabled for Pi children.

## Use in Pi

Run `/reload` to load the changes. A child created before reloading is disposed by the existing subagent lifecycle; finish or cancel important child work first.

- `subagent_message({ id, message })` steers a running child when the backend supports it, or continues a settled child.
- Pi children receive `ask_parent({ question })`. It waits inside the tool call and returns the parent's answer. It has no ordinary tool-execution timeout because a decision may require human input; cancellation and shutdown still release it.
- The parent receives the child id, question text, and question id. Answer using `subagent_message({ id, message, reply_to })`. Wrong/stale question ids are rejected.
- `subagent_wait` returns when all requested children settle **or** any one needs a reply. Other children may still be running. Answer the question, then wait again if needed.
- `subagent_check`, `subagent_list`, and the takeover UI expose pending questions. Typing in the takeover UI answers the currently displayed pending question.
- Private `/btw` sessions remain outside model-facing messaging and do not receive `ask_parent`.

Structured child questions are implemented for the Pi backend. Claude and Codex children receive parent messages through their existing backends; this change does not inject an `ask_parent` tool into those external harnesses. A Pi child may itself use an OpenAI model; the harness determines this capability.

## Herdr panes

When the interactive parent Pi session runs inside Herdr (`HERDR_ENV=1` and a caller pane id), a model-spawned child opens a sibling pane automatically. Each split uses current caller geometry to choose right/down, preserves the child's working directory, and does not take focus. Outside Herdr there are no pane-control calls; the existing `/subagents` UI continues to work.

Commands:

```text
/subagent-panes status
/subagent-panes off
/subagent-panes on
/subagent-pane sa-1
```

The on/off setting lasts until extension reload. Turning it off leaves already-open panes alone. Reopening a child creates a new viewer and disconnects its previous viewer. If pane creation fails, the child continues running and Pi reports that `/subagents` is still available.

Each pane is an interactive **view of the existing child**, using Pi's terminal UI components. This differs from launching a full second Pi CLI process as the compared tmux setup does. It supports Pi, Claude, and Codex children without concurrently opening their session files in another agent.

- Enter: send a message or answer the displayed pending question.
- Page Up / Page Down: scroll the transcript.
- Ctrl+X: cancel the child.
- Ctrl+D: detach the viewer while leaving the child running.

The pane is not a second full Pi command interface: input goes to the child as a message, not a local Pi slash command. Use the parent `/subagents` controls for management. These viewers are ordinary terminal processes, not separate Herdr-recognized Pi agent occupants. They can be focused, resized, and closed as normal panes.

Communication uses an owner-only temporary directory and mode-600 Unix socket for each child. The server only accepts resize, message/reply, and cancel operations for its assigned child. It does not accept arbitrary agent IDs or shell commands. Terminal text uses the existing transcript renderer. The socket and viewer close when the parent shuts down/reloads; shell panes are left in place rather than automatically closing a pane the user may have repurposed.

No Herdr-managed integration file was changed. Herdr state hooks continue to be owned by Herdr.

## Verification and first live check

Automated tests exercise reply correlation, cancellation, parent wait wakeup, private socket messages and cleanup, caller-context checks, generated Herdr targets/focus/cwd, and the actual viewer in a pseudoterminal with a typed reply. Tests do not call a paid model.

```fish
cd ~/.pi/agent/extensions/subagents
npm test
npm run check
```

The development task was outside Herdr, so live pane creation was not run. To check it from your Pi session inside Herdr, finish existing child work, run `/reload`, and ask:

```text
Spawn one Pi child named comms-demo. It must use ask_parent to ask whether
its final answer should be “ready”. Answer yes using subagent_message with
the supplied reply_to id, then collect its result. Do not edit files.
```

Expected: a sibling child pane appears without stealing your focus; the question is visible; the parent answers; the child finishes. You can then type a follow-up in its pane or detach with Ctrl+D. This live check uses your configured model and its normal account usage.
