# Subagents extension

Runs asynchronous child agents with isolated context windows.

## Harnesses

- `pi`: in-process pi SDK session; inherits the parent model and thinking level by default
- `codex`: Codex app-server session; requires an authenticated `codex` executable

Both have normal coding access. Child pi sessions exclude orchestration and interactive-question tools to prevent recursive delegation.

## Model tools

- `subagent_spawn`
- `subagent_check`
- `subagent_list`
- `subagent_wait`
- `subagent_cancel`

Four runs may execute concurrently and up to 64 are retained in session memory. Runs are cancelled when the parent session shuts down. Completed output is delivered automatically unless a waiting tool call consumes it.

## Commands

- `/subagents` opens the management UI for viewing, steering, and cancellation.
- `/btw [question]` starts a pi side-question agent.
