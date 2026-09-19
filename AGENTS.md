# Global working agreements

These are my default preferences for agent-assisted work on this machine. A
repository's `AGENTS.md` supplies project-specific context and may override
these defaults. My instructions in the current conversation take precedence.

## How to work with me

- Lead with the outcome. Explain technical details in plain language and only
  to the depth needed for the decision at hand.
- Use active voice, consistent terminology, and short paragraphs with one topic
  each.
- Keep progress updates concise and useful. Surface assumptions, material
  tradeoffs, unexpected findings, and blockers while work is in progress.
- Questions, explanations, reviews, audits, and status requests are read-only.
  Do not edit files or change external state unless I also ask for a change.
- When I ask to build, change, or fix something, carry the work through relevant
  verification. Make reasonable, low-risk assumptions instead of stopping for
  minor ambiguities.
- Ask before acting when a missing choice would materially change the result,
  expand the scope, incur cost, expose information, or affect external systems
  or other people.
- Ask one question at a time when clarification is required.
- If I give a stop point such as "draft only," "do not commit," or "local
  changes only," stop there.

## Understand the workspace first

- Read the applicable repository and nested instruction files before acting.
- Inspect the current implementation, nearby patterns, configuration, and Git
  state before proposing or making changes. Do not assume a path, command, or
  architecture from a different project.
- Treat `~/Documents/work` as the normal location for code repositories.
- Treat `~/Documents/Obsidian/quilt` as my Obsidian vault when I ask to create or
  save a note. Preserve the vault's existing organization and conventions.
- Prefer existing project tools, libraries, patterns, and scripts. Detect the
  package manager from the repository rather than applying a global preference.
- Use an applicable skill when the task matches it. Keep specialized workflows
  in skills rather than growing this file with one-off procedures.

## Scope and design

- Understand the real constraint, then implement the smallest complete solution
  that makes the correct behavior unsurprising.
- Channel both "measure twice, cut once" and YAGNI. Do not preserve accidental
  complexity, but do not introduce abstractions, compatibility layers, or
  machinery without a present need.
- Fight scope creep. Fix adjacent issues only when they block the requested work
  or are necessary for correctness; otherwise report them separately.
- Do not change public behavior, data models, dependencies, architecture, or
  security boundaries casually. Explain meaningful tradeoffs before committing
  to a direction that is difficult to reverse.
- Bold ideas are welcome when they materially improve the work. Clearly
  distinguish a recommendation from the scoped implementation I requested.

## Editing and implementation

- Preserve unrelated user changes and work safely in a dirty worktree. Never
  discard, overwrite, or reformat unrelated work.
- Solve root causes rather than masking symptoms. Follow established local
  conventions unless there is a concrete reason not to.
- Prefer clear types and explicit boundaries. Avoid unsafe casts, untyped escape
  hatches, and duplicated sources of truth when a reasonably typed design exists.
- In TypeScript, prefer inferred types within implementations and explicit types
  where they clarify boundaries. Avoid `any`; validate unknown input and narrow
  it.
- Comments should explain intent, invariants, constraints, or non-obvious use;
  do not narrate straightforward code. Keep relevant comments and documentation
  synchronized with behavior.
- Do not hand-edit generated files when a source or generator exists.
- Add a dependency only when it earns its cost and no suitable existing or
  platform capability is available. Ask before adding a production dependency.
- Add, update, and remove dependencies through the repository's package manager;
  keep its existing lockfile.
- Do not expose, print, commit, or move secrets. Treat credentials, tokens,
  customer data, and production resources as sensitive even when locally
  accessible.

## Commands and running processes

- I use Ghostty with the fish shell. Write user-facing terminal commands in fish
  syntax, not Bash, unless I explicitly request another shell.
- Prefer focused inspection and targeted commands. Use `rg`/`rg --files` for
  search when available.
- Do not start a development server merely to inspect code. Start one when it is
  needed for requested implementation or verification, use an isolated port or
  project-supported isolated environment, and record the exact PID.
- Stop only processes started for the current task, using their recorded PIDs.
  Never use broad process-name or pattern-based kill commands.
- Avoid destructive commands. Resolve exact targets with read-only checks first,
  and ask before an action could destroy or irreversibly overwrite meaningful
  data.

## Verification

- Match verification effort to the risk and scope of the change. Prefer
  targeted type checks, lint, and focused tests before full-repository checks.
- Add or update tests when they protect meaningful behavior or reproduce a real
  defect. Do not create low-value tests solely to increase coverage or test
  deleted implementation details.
- For user-visible work, inspect the real rendered result when practical and
  when the repository supports it. Check the relevant surfaces and states, not
  just the first happy path.
- Never claim a command, test, build, visual check, deployment, or external
  action succeeded unless it actually ran and its result was observed.
- If verification cannot run or fails for a reason outside the scoped change,
  report the exact limitation and distinguish it from a regression.
- If the project lacks useful validation commands, explain the gap and suggest
  an appropriate addition.

## Git and external actions

- Keep changes focused and review the diff against the intended base before
  presenting them as complete.
- Do not commit, amend, rebase, push, force-push, open or merge a pull request,
  deploy, publish, or send messages unless I explicitly request that action.
- Never push directly to a protected or primary branch without explicit
  permission. Do not add AI co-author trailers.
- Verify automated review findings against the source before changing code. Do
  not let review feedback expand the work beyond the original goal.

## Delegation

- Match ceremony to the task. Do not use subagents or multi-agent workflows for
  work one agent can finish cleanly in one pass.
- Delegate only when I request it or when repository instructions explicitly
  require it. If several agents edit in parallel, divide file ownership up front
  so their changes cannot collide.

## Completion

- Finish with a concise account of what changed, where it changed, what was
  verified, and any remaining risk or decision.
- Link directly to important local files when the interface supports it.
- Do not bury the result in a chronological tool log or an implementation
  inventory. Put the human-relevant outcome first.
