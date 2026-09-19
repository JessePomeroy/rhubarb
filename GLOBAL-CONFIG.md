# Use rhubarb with shared global configuration

The published repository contains ordinary files for `AGENTS.md` and each skill.
They work in a fresh clone without access to the author's personal folders. The
author's live installation instead uses symlinks to a separate shared configuration
folder; those machine-specific links are deliberately not published.

You can adopt the same arrangement. A skill is a **whole directory**, containing
`SKILL.md` and potentially scripts, references, assets, and agent metadata. Copy the
whole directory, not just the Markdown entrypoint.

## Choose a canonical home

For example:

```text
~/Documents/work/agent-config/
  AGENTS.md
  skills/
    pdf-reader/
      SKILL.md
      scripts/
    youtube-transcript/
    web-debug/
```

Keep a clean rhubarb checkout separately when possible. Copy selected packages from
that checkout into the canonical home, then link your agents' discovery paths to
those copies. The canonical copies become your editable source of truth; the clean
checkout remains a place to review upstream updates.

There is no universal configuration path understood by every agent. Common paths
used by this setup are:

| Consumer        | Instructions                              | Skills                              |
| --------------- | ----------------------------------------- | ----------------------------------- |
| Pi              | `~/.pi/agent/AGENTS.md`                   | `~/.pi/agent/skills/<name>/`        |
| Codex           | `~/.codex/AGENTS.md`                      | `~/.agents/skills/<name>/`          |
| Other harnesses | Their documented instruction setting/path | Their documented skill setting/path |

Existing `~/.codex/skills/<name>` links may also be used for compatibility. Avoid
adding duplicate discovery paths unnecessarily, and verify discovery in each
harness. Shared files do not provide missing tools: `web-debug` uses Pi's browser
bridge, for example, while `pdf-reader` requires Poppler and `youtube-transcript`
requires yt-dlp. Pi orchestration skills also need their corresponding extensions.

## Copy and link a skill safely

These commands use **fish** on Linux. Run them from your rhubarb checkout and change
`skill_name` for each package you want. They intentionally refuse to replace an
existing canonical package or discovery path, including broken symlinks.

```fish
set repo (pwd)
set shared "$HOME/Documents/work/agent-config"
set skill_name pdf-reader

set source "$repo/skills/$skill_name"
set canonical "$shared/skills/$skill_name"
set pi_link "$HOME/.pi/agent/skills/$skill_name"
set shared_link "$HOME/.agents/skills/$skill_name"

if not test -f "$source/SKILL.md"
    echo "Run from the rhubarb checkout and choose an existing skill."
else if test -e "$canonical"; or test -L "$canonical"
    echo "Canonical skill already exists; compare and merge it first."
else if test -e "$pi_link"; or test -L "$pi_link"
    echo "Pi skill already exists; back it up before replacing it."
else if test -e "$shared_link"; or test -L "$shared_link"
    echo "Shared discovery path already exists; inspect it first."
else
    mkdir -p "$shared/skills" "$HOME/.pi/agent/skills" "$HOME/.agents/skills"
    if cp -aL "$source" "$canonical"
        if diff -qr "$source" "$canonical"
            ln -sT "$canonical" "$pi_link"
            ln -sT "$canonical" "$shared_link"
        end
    end
end
```

If rhubarb is already installed at `~/.pi/agent`, its skill directory is also the
source, so the example correctly stops at the existing Pi path. In that case:

1. Copy the complete skill to the canonical folder and compare both copies.
2. Move the original Pi skill directory to a unique backup location outside the
   checkout. Preserve any personal edits before doing so.
3. Create the Pi symlink at the now-vacant path, and the shared discovery link if
   that path is also vacant.

Do not copy onto an existing symlink, delete an existing package, or run a recursive
merge blindly. Inspect existing targets with `readlink -f` and compare their contents.
Use `ln -sT` only after checking that the destination is vacant; never add `-f` as
an automatic conflict resolution.

Reload Pi after active child work finishes. Start a new session in other harnesses
as needed and verify that the skill is listed once and that its helper scripts run.

## Share global instructions

Read rhubarb's `AGENTS.md` before adopting it: it contains the author's preferences,
including shell, repository locations, Obsidian paths, and approval boundaries.
Adapt those to your own workflow.

If you already have global instructions, merge the agreements you want into your
canonical `AGENTS.md`; do not replace them wholesale. Preserve repository-specific
instructions inside each project rather than moving them into the global file.

After reviewing the merged file and backing up existing global instruction files,
link each now-vacant discovery path to the canonical file. For example, in fish:

```fish
set canonical "$HOME/Documents/work/agent-config/AGENTS.md"
# Run each command only after its destination has been inspected and backed up.
ln -sT "$canonical" "$HOME/.pi/agent/AGENTS.md"
ln -sT "$canonical" "$HOME/.codex/AGENTS.md"
```

These commands are examples, not a request to replace existing files. They require
the canonical file and parent directories to exist and intentionally omit force.

## Updates and Git status

Copying a skill creates an independent snapshot. Pulling rhubarb does **not** update
your global copy. Review the upstream diff in the clean checkout, compare it with
your canonical package, and merge desired changes there. All linked agents then
read the same updated files after their appropriate reload.

When the active Pi directory is itself the rhubarb Git checkout, replacing tracked
files/directories with symlinks causes expected Git differences: type changes,
apparent deleted skill files, and untracked directory symlinks. Do not use
`git reset --hard`, `git clean`, or forced checkout to hide these differences. Do
not stage the links with a blanket `git add --all` and publish absolute home paths.
For publication, export regular-file snapshots into a clean checkout or deliberately
stage the canonical contents while preserving the live links.

Before pulling changes into such an active checkout, inspect both Git state and
link targets. A separate clean checkout is the simpler place to compare upstream
changes without disturbing a running configuration.

To undo global sharing, back up your canonical data, confirm each discovery entry
is the symlink you created, remove only that link, and restore its saved original
file or package. Keep the canonical directory until all consumers are accounted for.
