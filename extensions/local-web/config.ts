import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export function localEndpoint(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Local web services must use an HTTP loopback URL without credentials, query, or fragment.",
    );
  }
  return url;
}

export function configuration() {
  return {
    search: localEndpoint(
      process.env.PI_SEARXNG_URL ?? "http://127.0.0.1:8088",
    ),
    crawl: localEndpoint(
      process.env.PI_CRAWL4AI_URL ?? "http://127.0.0.1:11235",
    ),
    browser: localEndpoint(
      process.env.PI_PLAYWRIGHT_MCP_URL ?? "http://127.0.0.1:8931/mcp",
    ),
  };
}

export async function crawlToken() {
  if (process.env.CRAWL4AI_API_TOKEN) return process.env.CRAWL4AI_API_TOKEN;
  const file =
    process.env.PI_CRAWL4AI_ENV_FILE ??
    join(homedir(), ".pi/agent/services/local-web/runtime/crawl4ai.env");
  const content = await readFile(file, "utf8").catch(() => "");
  const token = content.match(/^CRAWL4AI_API_TOKEN=(.+)$/m)?.[1]?.trim();
  if (!token)
    throw new Error(
      "Crawl4AI token missing. Start services/local-web/services.py or set CRAWL4AI_API_TOKEN.",
    );
  return token;
}
