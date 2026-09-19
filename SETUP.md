# Installing rhubarb

Rhubarb is designed to be the active pi configuration directory at `~/.pi/agent`.

## Requirements

- Node.js 22 or newer
- npm
- Git
- [pi](https://pi.dev)
- Codex CLI for Codex subagents
- Docker and a Linux user systemd session for the optional local web stack
- Python 3 for local service management and analysis skills
- A Firecrawl API key only if you opt into its paid fallback
- GitHub CLI for pull-request information
- `wl-clipboard` on Wayland Linux for `/copy-all`

`fd` and `rg` are preferred from the system. When absent on supported macOS/Linux arm64/x64 machines, rhubarb downloads pinned official releases and verifies their SHA-256 hashes.

## Preserve an existing pi installation

Pi stores credentials and sessions inside `~/.pi/agent`, so back it up before cloning:

```fish
mv ~/.pi/agent ~/.pi/agent.backup
git clone https://github.com/JessePomeroy/rhubarb.git ~/.pi/agent
cd ~/.pi/agent
npm install
```

Restore only private runtime files you want to keep:

```fish
cp ~/.pi/agent.backup/auth.json ~/.pi/agent/auth.json
cp -a ~/.pi/agent.backup/sessions ~/.pi/agent/sessions
```

If this is a new pi installation, omit those copies and authenticate with `/login`.

Do not copy an old `settings.json` over rhubarb's tracked settings unless you intend to merge its values manually.

## Local web tools

Follow [the local web setup guide](services/local-web/README.md) to install the
extension-local dependencies, browser runtime, and start the localhost services.
Search and extraction use SearXNG/Crawl4AI by default; browsing uses Playwright MCP.
Firecrawl is disabled unless explicitly enabled.

## Shared skills and personal settings

This repository contains regular-file snapshots of the author's shared skills and
AGENTS.md, so a clone does not depend on personal symlink targets. The author's
active installation keeps those symlinks; Git may therefore show local type changes
and apparent missing skill files even after a snapshot is committed. Do not reset
or overwrite those links to clean the status. Refresh published snapshots from the
canonical files when sharing future changes.

Review AGENTS.md's personal preferences and paths before using them. Select a model
available in your own account with Pi's model picker; tracked settings reflect the
author's current setup. Local `models.json` is not published.

PDF reading needs Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`). YouTube captions need
`yt-dlp` (for example, `uv tool install yt-dlp`). Session analysis uses standard
Python only. These skills do not require paid extraction/transcription APIs.
See [subagent controls](extensions/subagents/README.md) for Herdr pane controls and
parent/child communication. Herdr is optional; the in-Pi manager works without it.

## Optional Firecrawl fallback

Create the ignored private environment file:

```fish
cp ~/.pi/agent/.env.example ~/.pi/agent/.env
chmod 600 ~/.pi/agent/.env
```

Set:

```dotenv
FIRECRAWL_API_KEY=fc-your-key
```

The extension also accepts `FIRECRAWL_API_KEY` from the process environment.
Start Pi with `env PI_ENABLE_FIRECRAWL=1 pi` to expose the fallback tools.

## Optional system integrations

### Wayland clipboard

On Arch/CachyOS:

```fish
sudo pacman -S --needed wl-clipboard
```

Other Linux clipboard fallbacks are `xclip` and `xsel`. macOS uses `pbcopy`; Windows uses `clip.exe`.

### GitHub pull requests

Install and authenticate GitHub CLI:

```fish
gh auth login
gh auth status
```

### Codex subagents

Install Codex CLI and authenticate it normally. Rhubarb discovers `codex` from `PATH` and communicates with `codex app-server --stdio`.

## Validate

```fish
cd ~/.pi/agent
npm run format:check
npm run check
npm test
npm audit --omit=dev
```

Start pi or run `/reload` in an existing interactive session. The Catppuccin theme, rhubarb header, dashboard footer, extensions, and skills should load automatically.

## Updating

Because `settings.json` and `AGENTS.md` are tracked, review local changes before pulling:

```fish
cd ~/.pi/agent
git status
git pull --ff-only
npm install
npm run check
npm test
```

Then run `/reload` or restart pi.

## Private and generated state

These paths are intentionally ignored:

- `.env`
- `auth.json`
- `models-store.json`
- `sessions/`
- `workflows/`
- `node_modules/`
- `bin/`

Never commit API keys or authentication files.

## Recovery

If an extension prevents normal startup, launch pi with extensions disabled:

```fish
pi --no-extensions
```

Then inspect changes, run the validation suite, or temporarily disable resources with `pi config`.

To restore the previous installation completely:

```fish
mv ~/.pi/agent ~/.pi/agent.failed
mv ~/.pi/agent.backup ~/.pi/agent
```
