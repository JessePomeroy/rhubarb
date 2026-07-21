---
name: subagents
description: Delegate independent work to asynchronous pi or Codex subagents. Use when tasks can be researched, reviewed, or implemented in parallel, or when the user asks for subagents.
---

# Subagents

Subagents have isolated context and cannot see the parent conversation. Every prompt must include the relevant paths, constraints, context, and expected report.

## Harnesses

- Use `pi` by default. It inherits the parent model and thinking level unless overridden.
- Use `codex` when a separate Codex coding pass is useful or explicitly requested.

Both harnesses receive normal coding tools. They cannot spawn subagents, run workflows, or ask the user questions.

## Lifecycle

1. Call `subagent_spawn` with a concise name and self-contained prompt.
2. Continue useful parent work while children run.
3. Use `subagent_check` only when a progress snapshot is needed.
4. Use `subagent_wait` when results are required before proceeding.
5. Use `subagent_cancel` for obsolete or stuck work.

At most four subagents run concurrently. Completed results are delivered automatically when not already consumed by `subagent_wait`.

The user can manage runs with `/subagents` and start a side question with `/btw`.
