# Background terminals

Session-scoped process management for servers, watchers, and other long-running commands.

Tools:

- `bg_start`
- `bg_status`
- `bg_list`
- `bg_kill`

`/ps` provides interactive inspection and termination. Processes receive no stdin. Output is captured in private temporary spill files while bounded tails are returned to the model.

All active process groups are terminated during pi shutdown or `/reload`, and temporary output is removed.
