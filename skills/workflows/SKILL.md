---
name: workflows
description: Run sandboxed multi-agent workflows when the user explicitly requests a workflow or says ultracode. Do not use for ordinary delegation.
---

# Ultracode workflows

Use the `workflow` tool only when the user says **ultracode** or explicitly asks for a workflow run. Use normal subagents for ordinary delegation.

The tool accepts inline JavaScript with:

- `phase(title)` to update progress
- `await agent(prompt, { label, phase, schema, model, provider, effort })`
- `await parallel([() => agent(...), ...], { concurrency })`
- `args` containing parsed tool arguments
- a final JSON-serializable `return` value

Declare metadata with `export const meta = { name, description, phases }`.

Every `agent()` resolves to `{ ok, output, structured?, error? }`; always check `ok`. Use `schema` when later phases need to branch on typed fields.

Workflows allow at most four concurrent children and 32 total agent calls. Scripts cannot import modules or access filesystem, network, process APIs, eval, or timers. Blocking runs stop when the parent turn is aborted. Background runs continue until completion or session shutdown and deliver their result automatically.

Use `/workflows` to inspect runs and artifact locations.
