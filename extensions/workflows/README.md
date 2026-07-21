# Workflows extension

Provides sandboxed, model-authored multi-agent workflows under the **ultracode** convention.

The `workflow` tool executes inline JavaScript with `phase`, `agent`, `parallel`, and `args`. Scripts run in a permission-restricted Node child with no imports or host APIs. Pi SDK children inherit the parent model and thinking level unless overridden.

Limits:

- four concurrent children
- 32 child calls per workflow
- 45 seconds for each child to begin responding
- three minutes per child tool call
- no overall workflow deadline

Runs may block or continue in the background. Artifacts are written privately under `~/.pi/agent/workflows/<run-id>/`. `/workflows` lists and inspects runs. Runs are not resumable.
