# Local web tools for Pi

Pi uses local services for web research by default. Search with SearXNG, extract Markdown or crawl related pages with Crawl4AI, and use Playwright MCP when browser interaction or inspection is necessary. These services do not make paid API or LLM extraction calls. Pi's selected model still has its normal account costs; websites and upstream search engines still receive network requests.

## Start and stop

Requirements: Docker daemon access, Python 3, a working Linux user systemd manager, and the existing Pi/Node installation. Docker Compose is not required. SearXNG and Crawl4AI run in Docker; Playwright MCP and its Chromium browser run directly on the host. The approved official MCP SDK dependency is installed inside `extensions/local-web/` with its own npm lockfile, following the existing extension-local package pattern.

Run these commands in fish:

```fish
python3 ~/.pi/agent/services/local-web/services.py start
python3 ~/.pi/agent/services/local-web/services.py status
```

Then use `/reload` in Pi or start a new Pi session. On a new installation, install the bridge, pinned browser server, and its matching Chromium build before starting:

```fish
npm --prefix ~/.pi/agent/extensions/local-web ci
npm --prefix ~/.pi/agent/services/local-web ci
npm --prefix ~/.pi/agent/services/local-web run browser:install
```

To stop only this setup's services:

```fish
python3 ~/.pi/agent/services/local-web/services.py stop
```

The manager checks ownership labels for containers and the description/working directory of the browser's systemd unit before managing them. It prints exact host PIDs. It reuses existing services without removing their data. No boot startup or restart policy is configured.

The browser runs as the transient user unit `pi-local-web-playwright.service`; systemd tracks its PID and stops its child processes together. The unit is released when stopped and recreated on the next start. Node's resolved installation path is used, so the service does not depend on an interactive fish/fnm shell. Restart the service after changing Node installations or browser package versions.

```fish
journalctl --user -u pi-local-web-playwright.service
```

SearXNG `2026.9.19-e831fc2a1` and Crawl4AI `0.9.3` are pinned by image digest in `services.py`. Playwright MCP `0.0.82` is pinned in this directory's `package.json` and npm lockfile. The matching Chromium build is installed in Playwright's normal user cache. The installer reported an Ubuntu fallback build on this distribution; the actual browser tests passed with Chromium sandboxing enabled.

The previous `pi-local-web-playwright` Docker container is retained **stopped** for recovery and is no longer managed or started by this script. Do not start it while the host service owns port 8931.

## Services and configuration

| Service        | Host endpoint               | Pi setting              |
| -------------- | --------------------------- | ----------------------- |
| SearXNG        | `http://127.0.0.1:8088`     | `PI_SEARXNG_URL`        |
| Crawl4AI       | `http://127.0.0.1:11235`    | `PI_CRAWL4AI_URL`       |
| Playwright MCP | `http://127.0.0.1:8931/mcp` | `PI_PLAYWRIGHT_MCP_URL` |

These environment variables override the **client** endpoints, not service listening ports. Client endpoints reject non-loopback hosts and credential-bearing URLs. Docker publishes SearXNG/Crawl4AI only on `127.0.0.1`; listening on `0.0.0.0` inside those containers is necessary for port forwarding and does not publish on the host's LAN interface. Playwright MCP binds directly to host `127.0.0.1:8931`.

The host browser has normal user-level host network access, including development servers listening only on localhost. It does not have Docker filesystem isolation. It uses a separate ephemeral browser context, Chromium sandboxing, and a dedicated working/output directory rather than your personal browser profile.

The startup script creates ignored local state under `runtime/`:

- `searxng/settings.yml`: enables JSON search responses and includes a generated secret. Engine settings can be edited here; restart the SearXNG service after editing. Rate limiting is off for this single-user loopback service. Upstream engines may still rate-limit or fail; results include `unresponsiveEngines`.
- `playwright/`: private host working/output directory for the native browser service. Artifacts can be read from the host; they are not saved inside a container.
- `crawl4ai.env`: a private, mode-600 file with a generated local API token. The extension reads the same file without displaying its contents. An existing external local instance can instead use `CRAWL4AI_API_TOKEN`, or `PI_CRAWL4AI_ENV_FILE` pointing to an equivalent env file. No paid provider keys are passed into the container.

Start waits for Docker and systemd to launch their processes, not full API readiness. If a newly started service is still initializing, wait for `/health` (Crawl4AI) or the SearXNG page before running verification. A port conflict or unrelated container/systemd unit with the same name causes an error rather than replacing it.

## Pi tools

| Tool            | Use                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `search`        | SearXNG snippets and links; `query`, optional `limit` (default 5, matching the old search tool). |
| `scrape`        | One URL as Markdown; `url`.                                                                      |
| `crawl`         | Same-origin breadth-first crawl; `url`, required `limit` and `maxDepth`, optional `pathPrefix`.  |
| `browser_tools` | List available MCP tools; specify `name` to retrieve the exact input schema.                     |
| `browser_call`  | Invoke a discovered MCP tool using `name` and `arguments`.                                       |

Crawling uses Crawl4AI's normal `/crawl` endpoint for each discovered page. The wrapper follows returned internal links, removes fragments, deduplicates URLs, and enforces the requested page/depth budget. Failed attempts count toward the budget. It reports partial failures and does not traverse external origins. This is focused link crawling, not an exhaustive sitemap crawler; query variants remain distinct. It does not expose LLM extraction, custom JavaScript hooks, or arbitrary provider configuration. Crawl4AI itself can render pages with Chromium, but this requires no paid model call.

Tools honor Pi cancellation. Playwright calls are serialized per client; MCP request deadlines follow the official SDK defaults. Text uses Pi's standard output limits; complete oversized output is saved to a private temporary file. Service errors surface to the agent without automatic Firecrawl fallback.

### Browser sessions

The MCP client connects lazily, so no connection/browser is started merely by loading the extension. Each Pi extension instance has its own isolated MCP browser session; no shared-context flag is enabled. Pi session shutdown closes the connection and terminates the MCP session. No existing personal Chrome profile is used. Browser actions still require the user's authority for submissions, purchases, and other external changes.

First ask `browser_tools` for the relevant schema. The server's current click tool uses `target`, not older examples' `ref` field. Use `browser_snapshot` to get accessible element references. Navigation may return a snapshot filename; request `browser_snapshot` for inline text. Images returned by MCP are forwarded as images. Host-generated artifacts live under `runtime/playwright/`; relative filenames resolve against that service working directory.

The host browser runs headless with `--sandbox --isolated`, and no persistent personal profile is supplied. The MCP server's Host allowlist is restricted to the two loopback authorities. Page-supplied WebMCP tools are disabled. This does not turn browser content into trusted instructions or make browser actions inherently read-only.

For your host development app, navigate directly to its URL, such as `http://127.0.0.1:5173` or `http://localhost:5173`. There is no need to expose the development server on a LAN interface. Crawl4AI still runs inside Docker and remains intended for public-page extraction; use the host browser for loopback-only apps.

## Optional Firecrawl fallback

Existing Firecrawl code, dependency, and credentials remain intact. Its extension registers no tools unless explicitly enabled:

```fish
env PI_ENABLE_FIRECRAWL=1 pi
```

This adds `firecrawl_search`, `firecrawl_scrape`, and `firecrawl_crawl` alongside the default local tools. Their descriptions require an explicit user request before use. Enabling makes paid calls possible; it is never triggered by local-service failure. Start Pi without this variable to disable the fallback again. Existing `.env` contents were not changed.

## Verification

The real verification script loads the extensions through Pi's loader and directly executes their registered tools. It never calls a language model or Firecrawl. The full check makes ordinary public web requests. The browser-only check creates an ephemeral server bound to `127.0.0.1`, reports its PID/port, exercises the rendered page through Pi tools, checks storage isolation with a second MCP connection, and closes the test server:

```fish
node ~/.pi/agent/services/local-web/verify.mjs
node ~/.pi/agent/services/local-web/verify.mjs --browser-only
```

Verified on 2026-09-19:

- Search found `svelte.dev` for “Svelte official documentation”.
- Extraction returned Example Domain as Markdown.
- A two-page crawl extracted the Crawl4AI documentation home and a linked page.
- Playwright navigated Example Domain, read its accessibility snapshot, and clicked its IANA link.
- Firecrawl registered no tools by default and three uniquely named tools when opted in, without calling the service.
- The host browser reached a loopback-only app and changed its displayed count by clicking.
- A second MCP session did not inherit the first session's localStorage.
- Docker port bindings and the host browser listener were checked for `127.0.0.1` only.

Focused tests cover service URL restrictions, same-origin/path/depth/page crawl behavior, cancellation, ordinary non-LLM extraction requests, and error propagation without paid fallback:

```fish
cd ~/.pi/agent
node --test extensions/local-web/web.test.ts
npm run check
```

## Relationship to the compared Pi setup

This provides the same three web capabilities as amosblomqvist's separate search, fetch, and browser extensions, using a locally hosted search/extraction stack and Microsoft's maintained MCP server. His prompt snippets and agent/memory extensions are independent and can be considered separately. Installing his browser extension as well would duplicate the browser surface; it is not needed for this setup.

References: [SearXNG search API](https://docs.searxng.org/dev/search_api.html), [Crawl4AI self-hosting](https://docs.crawl4ai.com/core/self-hosting/), [Crawl4AI server migration](https://github.com/unclecode/crawl4ai/blob/main/deploy/docker/MIGRATION.md), [Playwright MCP](https://github.com/microsoft/playwright-mcp).
