# Share instructions and skills across agents

Rhubarb provides Pi extensions and a small set of bundled skill snapshots. The
separate [Iced Coffee Suite](https://github.com/JessePomeroy/iced-coffee-suite) distribution contains the broader, agent-neutral suite:
portable packages, a catalog, a personal instruction template, and a preview-first
installer. It does not require Rhubarb or Pi.

Keep the two responsibilities separate: use Rhubarb for its Pi runtime tools, and
use an [Iced Coffee Suite](https://github.com/JessePomeroy/iced-coffee-suite) checkout when you want to share selected workflows across
local coding agents. That checkout's `README.md`, `INSTALL.md`, and `docs/CATALOG.md`
are the installation entrypoints. Keep it at a stable path; installed links point
back to its files.

## Start from an Iced Coffee Suite checkout

Obtain the companion checkout separately and inspect its instructions and installer.
The examples below use zsh-compatible syntax; replace the example path with its
actual location. Nothing in these examples requires changing Rhubarb's extensions.

```zsh
iced_coffee_suite_dir="$HOME/Documents/work/iced-coffee-suite"
python3 "$iced_coffee_suite_dir/install.py" --list
python3 "$iced_coffee_suite_dir/install.py" --agent codex --skill diagnosing-bugs --skill pdf-reader
```

The installer previews changes by default. After reviewing the plan, use the same
selection with `--apply`. It refuses existing files, directories, and unrelated
symlinks, including broken ones. It does not merge packages, install dependencies,
connect accounts, or change global instructions unless explicitly requested.

For Pi, choose `--agent pi`. Repeat `--agent` for multiple local agents, or use
`--skills-dir` with another tool's documented discovery directory. Avoid linking
an additional copy if the same package is already discoverable through another root.

| Consumer    | Default skill discovery     | Optional global instruction destination |
| ----------- | --------------------------- | --------------------------------------- |
| Codex       | `~/.agents/skills/<name>`   | `~/.codex/AGENTS.md`                    |
| Claude Code | `~/.claude/skills/<name>`   | `~/.claude/CLAUDE.md`                   |
| Gemini CLI  | `~/.agents/skills/<name>`   | `~/.gemini/GEMINI.md`                   |
| Pi          | `~/.pi/agent/skills/<name>` | `~/.pi/agent/AGENTS.md`                 |

Codex and Gemini share a skill root. Existing legacy Codex links may still be
present; do not add or remove compatibility aliases without checking the actual
host's discovery behavior. Use custom destinations for nondefault agent homes.
Local links do not make skills available in remote or cloud sessions.

## Personalize the global agreements

The companion repo's `instructions/AGENTS.example.md` is the template for personal
working agreements. Its root `AGENTS.md` is for maintaining that repository and
must not be installed globally.

Read existing agreements and merge the desired defaults into a personal file.
Adapt shell, workspace, business, and vault settings rather than adopting the
author's preferences wholesale. Preserve the original files. Keep project-specific
instructions in their projects and private settings outside version control.

Once the personalized file exists, preview its links, for example:

```zsh
python3 "$iced_coffee_suite_dir/install.py" --agent codex --agent pi \
  --instructions "$iced_coffee_suite_dir/instructions/AGENTS.local.md"
```

The example personal filename is ignored by the companion repo. Add `--apply`
within the user's authorization after inspecting the plan. If a destination already
exists, the installer stops: compare/merge it and preserve a backup before any
separately authorized replacement. Never copy onto an existing instruction symlink;
that can overwrite the canonical shared file.

## Existing Rhubarb installations

The published Rhubarb repository contains ordinary-file snapshots of its bundled
skills and instructions. A fresh clone does not depend on the author's home paths.
The author's live installation instead links selected files to a separate canonical
`agent-config` folder. The new portable checkout does not migrate those live links
or change that folder automatically.

If Rhubarb already occupies `~/.pi/agent`, a bundled skill directory or existing
shared link can conflict with a requested companion install. That is expected.
Compare the complete packages, preserve local changes, and explicitly choose which
copy will be canonical before replacing anything. Do not recursively merge or
force a link merely to get a clean installer result.

A skill is its whole directory: `SKILL.md`, scripts, references, assets, and optional
agent metadata. Copying just the entrypoint can leave a skill discoverable but broken.
Shared instructions do not supply missing tools. PDF reading needs Poppler,
YouTube captions need yt-dlp, browser work needs the active harness's actual browser
tools, and Rhubarb's orchestration skills need its corresponding extensions.

## Verify, update, and remove

Run the same companion selection with `--check` to verify link targets. Then reload
Pi after active child work finishes, or start a fresh session in another agent.
Confirm discovery and exercise a relevant read-only workflow. Link checks alone do
not prove that an agent loaded the skill or that optional services are available.

Review Git state and incoming changes before updating either checkout. Pulling
Rhubarb does not update independent canonical copies or the companion repo. Updating
the companion changes the files its linked agents read after an appropriate reload.
Preserve personal edits rather than replacing a maintained edition by name.

To remove companion links, repeat their original selection with `--remove`, preview
it, then add `--apply` when authorized. Only selected symlinks still pointing at the
expected sources are removed. Source packages and personalized agreements are kept.
Restore any saved pre-install configuration separately after inspecting it.

When an active Pi directory is also a Git checkout, machine-specific links can
appear as type changes, deleted tracked skill files, and untracked directory links.
Do not use a forced checkout, `git reset --hard`, `git clean`, or blanket staging to
hide or publish them. Use a clean checkout when preparing regular-file snapshots
for publication. Preserve live links and unrelated working changes.
