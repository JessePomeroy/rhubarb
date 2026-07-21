# How rhubarb works

Rhubarb is both a Git repository and the live pi configuration directory. Pi discovers its extensions, skills, and theme through `package.json`, while global behavior comes from `AGENTS.md` and `settings.json`.

## Startup

When pi starts:

1. `settings.json` selects the OpenAI Codex model defaults and Catppuccin Mocha theme.
2. `AGENTS.md` adds global coding and communication preferences.
3. Pi discovers the extensions declared in `package.json`.
4. Skills are advertised by name and description, then loaded on demand.
5. The UI extension installs the rhubarb header and dashboard footer.
6. File-search resolves system or verified fallback binaries.
7. Session-scoped managers initialize for subagents, workflows, and background terminals.

Extensions execute with the current user's OS permissions. Rhubarb adds lifecycle limits and orchestration boundaries, but it is not a general sandbox for normal coding tools.

## Choosing the right capability

### Normal coding

Use the parent pi session for focused work. It has the normal coding tools plus `fd`, `rg`, Firecrawl, structured questions, terminals, subagents, and workflows.

### Web research

1. `firecrawl_search` finds current web or news results.
2. `firecrawl_scrape` reads a selected page.
3. `firecrawl_crawl` collects a bounded site section only when multiple pages are needed.

Crawls default to 10 pages and cannot exceed 100. Oversized model output spills to private temporary files.

### Independent delegation

Use `subagent_spawn` for ordinary independent work.

- `pi` children run in-process with the pi SDK and inherit the parent model and thinking level unless overridden.
- `codex` children use Codex app-server.
- Children have normal coding access but cannot recursively spawn agents, run workflows, or ask interactive questions.
- Four children may run concurrently; 64 records remain available in session memory.
- Completion is delivered automatically unless `subagent_wait` is already consuming it.

Use `/subagents` to inspect, steer, or cancel active runs. `/btw` starts a side-question pi child.

### Ultracode workflows

Use the `workflow` tool only when the user says **ultracode** or explicitly requests a workflow.

Workflow scripts are inline JavaScript with:

- `phase(title)`
- `await agent(prompt, options)`
- `await parallel([thunks], { concurrency })`
- parsed `args`
- a final return value

Workflow children are isolated pi SDK sessions. They inherit the parent model but can override `provider`, `model`, and `effort`. A JSON Schema can require a terminating `structured_output` result.

The JavaScript coordinator runs in a permission-restricted child process without imports, filesystem, network, process APIs, `eval`, or timers. It permits four concurrent children and 32 total calls. Children must begin responding within 45 seconds; individual child tool calls time out after three minutes. There is no overall workflow deadline.

Blocking workflows follow parent-turn cancellation. Background workflows continue until completion or session shutdown and deliver a follow-up result. Runs are not resumable.

Use `/workflows` to inspect run summaries and artifact paths.

### Long-running commands

Use `bg_start` for servers, watchers, and streaming builds. Use normal `bash` for quick commands.

Background terminals:

- receive no stdin;
- capture output in mode-`600` temporary files;
- expose bounded output through `bg_status`;
- deliver completion automatically;
- terminate the complete process group on `bg_kill`, `/reload`, or shutdown.

Use `/ps` for interactive management. Spill files are deleted at session shutdown.

### Questions

`ask_user` presents one question with 2–5 choices and an automatic custom-answer path. Dismissal does not grant permission to assume an answer. In non-interactive modes, the model is told to ask in plain text.

### Search

- `fd` discovers paths without shell `find` pipelines.
- `rg` searches content without shell `grep` pipelines.

Both use argv-based process execution, bounded output, and private spill files.

## UI

The Catppuccin Mocha theme styles messages, tools, Markdown, syntax, diffs, and thinking levels.

The custom header displays lowercase gradient `rhubarb` art. The footer shows:

- current directory;
- provider/model and thinking level;
- context percentage/window;
- session cost and recent output speed;
- Git branch, changed files, and PR number;
- extension status rows for active agents, workflows, and terminals.

Git information refreshes after shell or file mutations rather than constant polling.

## Commands

| Command      | Purpose                                               |
| ------------ | ----------------------------------------------------- |
| `/subagents` | Inspect, steer, and cancel subagents                  |
| `/btw`       | Start a side-question agent                           |
| `/workflows` | Inspect workflow runs and artifacts                   |
| `/ps`        | Manage background terminals                           |
| `/lg`        | Browse changed files and diffs                        |
| `/pr`        | Show the current branch's pull request                |
| `/copy-all`  | Copy user and assistant messages on the active branch |
| `/reload`    | Reload rhubarb resources                              |

## State and lifecycle

| Data                    | Location               | Lifetime              |
| ----------------------- | ---------------------- | --------------------- |
| Preferences             | `settings.json`        | Tracked               |
| Global instructions     | `AGENTS.md`            | Tracked               |
| Firecrawl key           | `.env`                 | Private, persistent   |
| Provider authentication | `auth.json`            | Private, persistent   |
| Pi sessions             | `sessions/`            | Private, persistent   |
| Workflow artifacts      | `workflows/<run-id>/`  | Private, persistent   |
| Downloaded `fd`/`rg`    | `bin/`                 | Generated, persistent |
| Background output       | OS temporary directory | Current pi session    |
| Large search/web output | OS temporary directory | Until OS cleanup      |
| Dependencies            | `node_modules/`        | Generated             |

Session shutdown cancels subagents, workflows, and terminal process groups. Workflow artifacts already written remain available. Background-terminal temporary output is removed.

## How the systems cooperate

A typical large task can proceed like this:

1. Firecrawl researches current external documentation.
2. `fd` and `rg` map relevant local code.
3. Several subagents independently inspect architecture, tests, and risks.
4. An explicit ultracode workflow runs phased review and synthesis when dynamic fan-out is justified.
5. The parent implements the selected approach.
6. A background terminal runs the dev server or test watcher while work continues.
7. `ask_user` resolves an enumerable product decision.
8. `/lg` reviews resulting diffs, while the footer shows Git and orchestration state.

The parent remains the coordinator. Subagents handle independent bounded tasks; workflows handle multi-phase orchestration; background terminals handle processes rather than reasoning.

## Development and validation

```bash
npm run format
npm run format:check
npm run check
npm test
npm audit --omit=dev
```

Tests cover manager concurrency and cancellation, workflow sandbox restrictions, process-group cleanup, file-search execution, UI width behavior, question outcomes, and Git parsing.

## Svelte

`AGENTS.md` instructs agents to load `svelte-best-practices` for Svelte/SvelteKit work. The skill favors modern Svelte 5 runes while respecting projects that intentionally remain in legacy mode. It also covers server boundaries, load functions, form actions, SSR safety, accessibility, and validation.
