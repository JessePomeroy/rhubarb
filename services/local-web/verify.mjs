// Loads Pi's registered tools and exercises them without any model/API call.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { BrowserClient } from "../../extensions/local-web/browser.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const sdkEntry = fileURLToPath(
  import.meta.resolve("@earendil-works/pi-coding-agent"),
);
const { loadExtensions } = await import(
  pathToFileURL(resolve(dirname(sdkEntry), "core/extensions/loader.js"))
);
const previousFallback = process.env.PI_ENABLE_FIRECRAWL;
delete process.env.PI_ENABLE_FIRECRAWL;
const loaded = await loadExtensions(
  [
    resolve(root, "extensions/local-web/index.ts"),
    resolve(root, "extensions/firecrawl-search/index.ts"),
  ],
  root,
);
assert.deepEqual(loaded.errors, []);
const [local, fallback] = loaded.extensions;
assert.equal(fallback.tools.size, 0, "Paid fallback must be absent by default");

async function call(name, args) {
  const registered = local.tools.get(name);
  assert.ok(registered, `Pi tool ${name} is registered`);
  const result = await registered.definition.execute(
    "local-web-verification",
    args,
    AbortSignal.timeout(120_000),
    undefined,
    undefined,
  );
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

// An ephemeral port bound only to host loopback reproduces the Docker limitation.
const fixture = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "text/html" });
  response.end(`<!doctype html><html><head><title>Pi localhost verification</title></head>
    <body><h1>Pi localhost verification</h1><button>Increment</button><p id="count"></p>
    <script>
    let count = Number(localStorage.getItem('pi-local-web-count') || 0);
    const render = () => document.querySelector('#count').textContent = 'Count: ' + count;
    document.querySelector('button').onclick = () => {
      localStorage.setItem('pi-local-web-count', String(++count)); render();
    }; render();
    </script></body></html>`);
});
await new Promise((resolve, reject) => {
  fixture.once("error", reject);
  fixture.listen(0, "127.0.0.1", resolve);
});
const address = fixture.address();
assert.ok(address && typeof address === "object");
const fixtureUrl = `http://127.0.0.1:${address.port}`;
console.log(`Loopback test server: PID=${process.pid}; ${fixtureUrl}`);

try {
  await call("browser_tools", { name: "browser_navigate" });
  await call("browser_call", {
    name: "browser_navigate",
    arguments: { url: fixtureUrl },
  });
  const localSnapshot = await call("browser_call", {
    name: "browser_snapshot",
    arguments: {},
  });
  assert.match(localSnapshot, /Pi localhost verification/);
  assert.match(localSnapshot, /Count: 0/);
  const button = localSnapshot.match(
    /button "Increment" \[ref=([^\]]+)\]/,
  )?.[1];
  assert.ok(button);
  await call("browser_tools", { name: "browser_click" });
  await call("browser_call", {
    name: "browser_click",
    arguments: { element: "Increment", target: button },
  });
  assert.match(
    await call("browser_call", { name: "browser_snapshot", arguments: {} }),
    /Count: 1/,
  );
  console.log(
    "PASS host localhost: browser reached the loopback-only app and changed its rendered count by clicking.",
  );
  const isolated = new BrowserClient();
  try {
    await isolated.call("browser_navigate", { url: fixtureUrl });
    const fresh = await isolated.call("browser_snapshot", {});
    assert.match(JSON.stringify(fresh.content), /Count: 0/);
    assert.doesNotMatch(JSON.stringify(fresh.content), /Count: 1/);
    console.log(
      "PASS browser isolation: a second MCP connection did not inherit localStorage.",
    );
  } finally {
    await isolated.close();
  }

  if (!process.argv.includes("--browser-only")) {
    const search = JSON.parse(
      await call("search", {
        query: "Svelte official documentation",
        limit: 3,
      }),
    );
    assert.ok(
      search.results.some(
        (result) => new URL(result.url).hostname === "svelte.dev",
      ),
    );
    console.log("PASS SearXNG: found official Svelte documentation.");
    const scrape = JSON.parse(
      await call("scrape", { url: "https://example.com" }),
    );
    assert.match(scrape.markdown, /Example Domain/);
    console.log(
      "PASS Crawl4AI extraction: Example Domain converted to Markdown.",
    );
    const crawl = JSON.parse(
      await call("crawl", {
        url: "https://docs.crawl4ai.com/",
        limit: 2,
        maxDepth: 1,
      }),
    );
    assert.equal(crawl.pages.length, 2);
    assert.equal(crawl.failures.length, 0);
    assert.ok(crawl.pages.every((page) => page.markdown.length > 0));
    console.log(
      "PASS Crawl4AI site crawl: two related documentation pages extracted.",
    );
    await call("browser_tools", { name: "browser_navigate" });
    await call("browser_call", {
      name: "browser_navigate",
      arguments: { url: "https://example.com" },
    });
    const snapshot = await call("browser_call", {
      name: "browser_snapshot",
      arguments: {},
    });
    assert.match(snapshot, /Example Domain/);
    const ref = snapshot.match(/link "Learn more" \[ref=([^\]]+)\]/)?.[1];
    assert.ok(ref, "Snapshot exposes the link reference");
    await call("browser_tools", { name: "browser_click" });
    const clicked = await call("browser_call", {
      name: "browser_click",
      arguments: { element: "Learn more", target: ref },
    });
    assert.match(clicked, /iana\.org/);
    console.log(
      "PASS Playwright MCP: navigated, inspected snapshot, and followed the IANA link.",
    );
  }
  process.env.PI_ENABLE_FIRECRAWL = "1";
  const enabled = await loadExtensions(
    [resolve(root, "extensions/firecrawl-search/index.ts")],
    root,
  );
  assert.deepEqual(enabled.errors, []);
  assert.deepEqual([...enabled.extensions[0].tools.keys()].sort(), [
    "firecrawl_crawl",
    "firecrawl_scrape",
    "firecrawl_search",
  ]);
  console.log(
    "PASS Firecrawl: disabled by default; opt-in tools register without making a paid request.",
  );
} finally {
  try {
    for (const shutdown of local.handlers.get("session_shutdown") ?? [])
      await shutdown();
  } finally {
    fixture.closeAllConnections();
    await new Promise((resolve, reject) =>
      fixture.close((error) => (error ? reject(error) : resolve())),
    );
    if (previousFallback === undefined) delete process.env.PI_ENABLE_FIRECRAWL;
    else process.env.PI_ENABLE_FIRECRAWL = previousFallback;
  }
}
