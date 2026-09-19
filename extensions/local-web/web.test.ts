import assert from "node:assert/strict";
import test from "node:test";
import { localEndpoint } from "./config.ts";
import { crawlSite, scrapePage, searchWeb, type Page } from "./web.ts";

test("service configuration rejects remote endpoints and credential URLs", () => {
  for (const url of [
    "https://example.com",
    "http://192.168.1.2",
    "http://user:pass@localhost",
    "http://localhost?token=x",
  ]) {
    assert.throws(() => localEndpoint(url));
  }
  assert.equal(localEndpoint("http://127.0.0.1:8088").hostname, "127.0.0.1");
});

test("crawl stays on origin/in prefix, deduplicates fragments, and counts failures in budget", async () => {
  const requested: string[] = [];
  const scrape = async (url: string): Promise<Page> => {
    requested.push(url);
    if (url.endsWith("broken")) throw new Error("Unreachable");
    return {
      url,
      title: "Test",
      markdown: "page",
      links: [
        "/docs/second#one",
        "/docs/second#two",
        "https://other.example/docs/third",
        "/other",
        "/docs/broken",
        "/docs/fourth",
      ],
    };
  };
  const result = await crawlSite(
    "https://test.example/docs/",
    3,
    1,
    "/docs/",
    undefined,
    scrape,
  );
  assert.deepEqual(requested, [
    "https://test.example/docs/",
    "https://test.example/docs/second",
    "https://test.example/docs/broken",
  ]);
  assert.equal(result.pages.length, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.attempted, 3);
});

test("crawl honors depth zero and does not swallow cancellation", async () => {
  const controller = new AbortController();
  let calls = 0;
  const scrape = async (url: string): Promise<Page> => {
    calls++;
    return { url, title: "Test", markdown: "page", links: ["/second"] };
  };
  await crawlSite("https://test.example", 3, 0, undefined, undefined, scrape);
  assert.equal(calls, 1);
  controller.abort();
  await assert.rejects(
    crawlSite(
      "https://test.example",
      3,
      1,
      undefined,
      controller.signal,
      scrape,
    ),
  );
  assert.equal(calls, 1);
});

test("Crawl4AI requests use only the ordinary crawl endpoint and preserve cancellation", async (t) => {
  const previous = process.env.CRAWL4AI_API_TOKEN;
  process.env.CRAWL4AI_API_TOKEN = "test-token";
  t.after(() => {
    if (previous === undefined) delete process.env.CRAWL4AI_API_TOKEN;
    else process.env.CRAWL4AI_API_TOKEN = previous;
  });
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    assert.equal(url.pathname, "/crawl");
    assert.equal(init.signal, controller.signal);
    assert.equal(init.redirect, "error");
    assert.deepEqual(JSON.parse(String(init.body)), {
      urls: ["https://example.com/"],
      crawler_config: {
        type: "CrawlerRunConfig",
        params: { cache_mode: "bypass" },
      },
    });
    return Response.json({
      results: [
        {
          success: true,
          url: "https://example.com/",
          markdown: { raw_markdown: "# Example" },
        },
      ],
    });
  });
  assert.equal(
    (await scrapePage("https://example.com", controller.signal)).markdown,
    "# Example",
  );
});

test("SearXNG failures surface directly without attempting a paid fallback", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url: URL) => {
    requests++;
    assert.equal(url.hostname, "127.0.0.1");
    return new Response("unavailable", { status: 503 });
  });
  await assert.rejects(searchWeb("test", 3), /HTTP 503/);
  assert.equal(requests, 1);
});
