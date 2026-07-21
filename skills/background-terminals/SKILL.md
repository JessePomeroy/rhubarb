---
name: background-terminals
description: Run and manage long-lived shell commands in background terminals. Use for dev servers, watchers, streaming builds, and commands that should continue while the agent works.
---

# Background terminals

Use `bg_start` for long-running commands and regular `bash` for quick commands.

Background commands receive no stdin. Give each one a meaningful title and working directory, then continue useful work rather than polling repeatedly.

- `bg_status` inspects current status and output.
- `bg_list` inventories the session's terminals.
- `bg_kill` terminates a command and its process group.
- `/ps` lets the user inspect and stop terminals interactively.

Completion is delivered automatically. Output is bounded for model context; full output remains in the private spill path until session shutdown. All terminals are session-scoped and stop during shutdown or `/reload`.
