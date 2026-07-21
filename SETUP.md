# Installing rhubarb

Rhubarb is designed to be the active pi configuration directory at `~/.pi/agent`.

## Requirements

- Node.js 22 or newer
- npm
- Git
- [pi](https://pi.dev)
- Codex CLI for Codex subagents
- A Firecrawl API key for web research
- GitHub CLI for pull-request information
- `wl-clipboard` on Wayland Linux for `/copy-all`

`fd` and `rg` are preferred from the system. When absent on supported macOS/Linux arm64/x64 machines, rhubarb downloads pinned official releases and verifies their SHA-256 hashes.

## Preserve an existing pi installation

Pi stores credentials and sessions inside `~/.pi/agent`, so back it up before cloning:

```bash
mv ~/.pi/agent ~/.pi/agent.backup
git clone https://github.com/JessePomeroy/rhubarb.git ~/.pi/agent
cd ~/.pi/agent
npm install
```

Restore only private runtime files you want to keep:

```bash
cp ~/.pi/agent.backup/auth.json ~/.pi/agent/auth.json
cp -a ~/.pi/agent.backup/sessions ~/.pi/agent/sessions
```

If this is a new pi installation, omit those copies and authenticate with `/login`.

Do not copy an old `settings.json` over rhubarb's tracked settings unless you intend to merge its values manually.

## Firecrawl

Create the ignored private environment file:

```bash
cp ~/.pi/agent/.env.example ~/.pi/agent/.env
chmod 600 ~/.pi/agent/.env
```

Set:

```dotenv
FIRECRAWL_API_KEY=fc-your-key
```

The extension also accepts `FIRECRAWL_API_KEY` from the process environment.

## Optional system integrations

### Wayland clipboard

On Arch/CachyOS:

```bash
sudo pacman -S --needed wl-clipboard
```

Other Linux clipboard fallbacks are `xclip` and `xsel`. macOS uses `pbcopy`; Windows uses `clip.exe`.

### GitHub pull requests

Install and authenticate GitHub CLI:

```bash
gh auth login
gh auth status
```

### Codex subagents

Install Codex CLI and authenticate it normally. Rhubarb discovers `codex` from `PATH` and communicates with `codex app-server --stdio`.

## Validate

```bash
cd ~/.pi/agent
npm run format:check
npm run check
npm test
npm audit --omit=dev
```

Start pi or run `/reload` in an existing interactive session. The Catppuccin theme, rhubarb header, dashboard footer, extensions, and skills should load automatically.

## Updating

Because `settings.json` and `AGENTS.md` are tracked, review local changes before pulling:

```bash
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

```bash
pi --no-extensions
```

Then inspect changes, run the validation suite, or temporarily disable resources with `pi config`.

To restore the previous installation completely:

```bash
mv ~/.pi/agent ~/.pi/agent.failed
mv ~/.pi/agent.backup ~/.pi/agent
```
