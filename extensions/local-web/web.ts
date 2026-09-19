import { configuration, crawlToken } from "./config.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function object(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("Invalid service response: expected an object");
  }
  return value;
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function webUrl(value: string) {
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "Only HTTP(S) URLs without embedded credentials are supported.",
    );
  }
  url.hash = "";
  return url;
}

async function jsonRequest(url: URL, options: RequestInit) {
  const response = await fetch(url, { ...options, redirect: "error" });
  if (!response.ok)
    throw new Error(
      `Local service ${url.origin}${url.pathname} returned HTTP ${response.status}`,
    );
  const data: unknown = await response.json();
  return object(data);
}

export async function searchWeb(
  query: string,
  limit: number,
  signal?: AbortSignal,
) {
  const url = new URL("search", configuration().search);
  url.search = new URLSearchParams({ q: query, format: "json" }).toString();
  const data = await jsonRequest(url, { signal });
  if (!Array.isArray(data.results))
    throw new Error("SearXNG response is missing results");
  const results = data.results.slice(0, limit).map((value) => {
    const item = object(value);
    return {
      title: text(item.title),
      url: text(item.url),
      snippet: text(item.content),
      engine: item.engine,
    };
  });
  return {
    query,
    results,
    unresponsiveEngines: data.unresponsive_engines ?? [],
  };
}

export type Page = {
  url: string;
  title: string;
  markdown: string;
  links: string[];
};

export async function scrapePage(
  url: string,
  signal?: AbortSignal,
): Promise<Page> {
  const target = webUrl(url);
  const token = await crawlToken();
  const data = await jsonRequest(new URL("crawl", configuration().crawl), {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    // Only ordinary Markdown extraction. No /llm, LLM strategy, API keys, or remote hooks.
    body: JSON.stringify({
      urls: [target.href],
      crawler_config: {
        type: "CrawlerRunConfig",
        params: { cache_mode: "bypass" },
      },
    }),
  });
  if (!Array.isArray(data.results) || data.results.length === 0)
    throw new Error("Crawl4AI returned no page results");
  const result = object(data.results[0]);
  if (result.success !== true)
    throw new Error(
      `Crawl4AI could not extract ${target.href}: ${text(result.error_message) || "unknown error"}`,
    );
  const markdown =
    typeof result.markdown === "string"
      ? result.markdown
      : text(object(result.markdown).raw_markdown);
  const metadata = result.metadata ? object(result.metadata) : {};
  const links = result.links ? object(result.links) : {};
  return {
    url: text(result.url) || target.href,
    title: text(metadata.title),
    markdown,
    links: Array.isArray(links.internal)
      ? links.internal.map((link) => text(object(link).href)).filter(Boolean)
      : [],
  };
}

export function sameSiteLink(
  link: string,
  parent: string,
  seed: URL,
  prefix?: string,
) {
  try {
    const url = webUrl(new URL(link, parent).href);
    if (
      url.origin !== seed.origin ||
      (prefix && !url.pathname.startsWith(prefix))
    )
      return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

export async function crawlSite(
  url: string,
  limit: number,
  maxDepth: number,
  prefix: string | undefined,
  signal?: AbortSignal,
  scrape: typeof scrapePage = scrapePage,
) {
  const seed = webUrl(url);
  const queue = [{ url: seed.href, depth: 0 }];
  const seen = new Set([seed.href]);
  const pages: Page[] = [];
  const failures: { url: string; error: string }[] = [];
  let attempted = 0;
  while (queue.length && attempted < limit) {
    signal?.throwIfAborted();
    const next = queue.shift();
    if (!next) break;
    attempted++;
    try {
      const page = await scrape(next.url, signal);
      pages.push(page);
      if (next.depth >= maxDepth) continue;
      for (const link of page.links) {
        const candidate = sameSiteLink(link, page.url, seed, prefix);
        if (!candidate || seen.has(candidate)) continue;
        seen.add(candidate);
        queue.push({ url: candidate, depth: next.depth + 1 });
      }
    } catch (error) {
      signal?.throwIfAborted();
      failures.push({
        url: next.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { pages, failures, attempted, remaining: queue.length };
}
