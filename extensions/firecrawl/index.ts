import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import Firecrawl, {
  type CrawlJob,
  type Document,
  type SearchData,
} from "firecrawl";
import { Type } from "typebox";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_CRAWL_LIMIT = 10;
const MAX_CRAWL_LIMIT = 100;
const CRAWL_TIMEOUT_MS = 5 * 60 * 1000;

function agentDirectory() {
  return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

function parseEnvValue(contents: string, name: string) {
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] !== name) continue;

    const value = match[2] ?? "";
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      return value.slice(1, -1);
    }
    return value.replace(/\s+#.*$/, "");
  }
  return undefined;
}

async function firecrawlApiKey() {
  if (process.env.FIRECRAWL_API_KEY) return process.env.FIRECRAWL_API_KEY;

  try {
    const contents = await readFile(join(agentDirectory(), ".env"), "utf8");
    return parseEnvValue(contents, "FIRECRAWL_API_KEY");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function client() {
  const apiKey = await firecrawlApiKey();
  if (!apiKey) {
    throw new Error(
      "FIRECRAWL_API_KEY is not set in the environment or ~/.pi/agent/.env",
    );
  }
  return new Firecrawl({ apiKey });
}

function documentUrl(document: Document) {
  return document.metadata?.sourceURL ?? document.metadata?.url ?? "unknown URL";
}

function formatDocument(document: Document, index?: number) {
  const heading = index === undefined ? "" : `## ${index + 1}. `;
  const title = document.metadata?.title ?? documentUrl(document);
  const parts = [
    `${heading}${title}`,
    `URL: ${documentUrl(document)}`,
  ];

  if (document.metadata?.description) {
    parts.push(`Description: ${document.metadata.description}`);
  }
  if (document.markdown) parts.push("", document.markdown);
  if (document.links?.length) {
    parts.push("", "Links:", ...document.links.map((link) => `- ${link}`));
  }
  return parts.join("\n");
}

function isDocument(result: object): result is Document {
  return (
    "metadata" in result ||
    "markdown" in result ||
    "html" in result ||
    "rawHtml" in result
  );
}

function formatSearch(data: SearchData) {
  const sections: string[] = [];

  if (data.web?.length) {
    sections.push("# Web results");
    data.web.forEach((result, index) => {
      if (isDocument(result)) {
        sections.push(formatDocument(result, index));
      } else {
        sections.push(
          [
            `## ${index + 1}. ${result.title ?? result.url}`,
            `URL: ${result.url}`,
            result.description ? `Description: ${result.description}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
    });
  }

  if (data.news?.length) {
    sections.push("# News results");
    data.news.forEach((result, index) => {
      if (isDocument(result)) {
        sections.push(formatDocument(result, index));
        return;
      }
      sections.push(
        [
          `## ${index + 1}. ${result.title ?? result.url ?? "Untitled"}`,
          result.url ? `URL: ${result.url}` : "",
          result.date ? `Date: ${result.date}` : "",
          result.snippet ? `Snippet: ${result.snippet}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    });
  }

  return sections.join("\n\n") || "No results found.";
}

interface OutputDetails {
  truncated: boolean;
  outputPath?: string;
}

async function boundedOutput(
  text: string,
  label: string,
): Promise<AgentToolResult<OutputDetails>> {
  const truncation = truncateHead(text, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  });

  if (!truncation.truncated) {
    return {
      content: [{ type: "text" as const, text: truncation.content }],
      details: { truncated: false },
    };
  }

  const directory = await mkdtemp(join(tmpdir(), "rhubarb-firecrawl-"));
  const outputPath = join(directory, `${label}.md`);
  await writeFile(outputPath, text, { encoding: "utf8", mode: 0o600 });

  const notice =
    `\n\n[Output truncated to ${truncation.outputLines} of ${truncation.totalLines} lines ` +
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
    `Full output: ${outputPath}]`;

  return {
    content: [{ type: "text" as const, text: truncation.content + notice }],
    details: { truncated: true, outputPath },
  };
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Cancelled"));
      return;
    }

    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Cancelled"));
      },
      { once: true },
    );
  });
}

async function waitForCrawl(
  firecrawl: Firecrawl,
  id: string,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback | undefined,
) {
  const startedAt = Date.now();

  try {
    while (Date.now() - startedAt < CRAWL_TIMEOUT_MS) {
      if (signal?.aborted) throw signal.reason ?? new Error("Cancelled");
      const job = await firecrawl.getCrawlStatus(id);

      onUpdate?.({
        content: [
          {
            type: "text",
            text: `Crawled ${job.completed}/${job.total || "?"} pages (${job.status})`,
          },
        ],
        details: {
          id,
          status: job.status,
          completed: job.completed,
          total: job.total,
        },
      });

      if (job.status === "completed") return job;
      if (job.status === "failed" || job.status === "cancelled") {
        throw new Error(`Firecrawl job ${job.status}`);
      }
      await sleep(2000, signal);
    }

    throw new Error("Firecrawl crawl timed out after 5 minutes");
  } catch (error) {
    await firecrawl.cancelCrawl(id).catch(() => undefined);
    throw error;
  }
}

export default function firecrawlExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "firecrawl_search",
    label: "Firecrawl Search",
    description: "Search the web or news with Firecrawl. Returns links and result snippets.",
    promptSnippet: "Search the web or news using Firecrawl",
    promptGuidelines: [
      "Use firecrawl_search for current web research, then firecrawl_scrape only on results whose full content is needed.",
    ],
    parameters: Type.Object({
      query: Type.String({ minLength: 1, description: "Search query" }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, default: 5 })),
      source: Type.Optional(
        StringEnum(["web", "news"] as const, { default: "web" }),
      ),
    }),
    async execute(_id, params) {
      const firecrawl = await client();
      const data = await firecrawl.search(params.query, {
        limit: params.limit ?? 5,
        sources: [params.source ?? "web"],
      });
      return boundedOutput(formatSearch(data), "search");
    },
  });

  pi.registerTool({
    name: "firecrawl_scrape",
    label: "Firecrawl Scrape",
    description: "Extract readable Markdown and metadata from one web page with Firecrawl.",
    promptSnippet: "Extract readable content from a web page using Firecrawl",
    parameters: Type.Object({
      url: Type.String({ format: "uri", description: "Public page URL" }),
      include_links: Type.Optional(
        Type.Boolean({ default: false, description: "Include links discovered on the page" }),
      ),
    }),
    async execute(_id, params) {
      const firecrawl = await client();
      const document = await firecrawl.scrape(params.url, {
        formats: ["markdown", ...(params.include_links ? (["links"] as const) : [])],
        onlyMainContent: true,
      });
      return boundedOutput(formatDocument(document), "scrape");
    },
  });

  pi.registerTool({
    name: "firecrawl_crawl",
    label: "Firecrawl Crawl",
    description:
      "Crawl multiple pages from a site with Firecrawl. Defaults to 10 pages and never exceeds 100.",
    promptSnippet: "Crawl a bounded set of pages from a website using Firecrawl",
    promptGuidelines: [
      "Use firecrawl_crawl only when multiple related pages are required; prefer firecrawl_scrape for a single URL.",
    ],
    parameters: Type.Object({
      url: Type.String({ format: "uri", description: "Site or section URL to crawl" }),
      limit: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: MAX_CRAWL_LIMIT,
          default: DEFAULT_CRAWL_LIMIT,
          description: "Maximum pages to crawl",
        }),
      ),
      max_depth: Type.Optional(
        Type.Integer({ minimum: 0, maximum: 10, description: "Maximum link depth" }),
      ),
      include_paths: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })),
      exclude_paths: Type.Optional(Type.Array(Type.String(), { maxItems: 20 })),
      allow_subdomains: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(_id, params, signal, onUpdate) {
      const firecrawl = await client();
      const started = await firecrawl.startCrawl(params.url, {
        limit: params.limit ?? DEFAULT_CRAWL_LIMIT,
        maxDiscoveryDepth: params.max_depth,
        includePaths: params.include_paths,
        excludePaths: params.exclude_paths,
        allowSubdomains: params.allow_subdomains ?? false,
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      });
      const job: CrawlJob = await waitForCrawl(firecrawl, started.id, signal, onUpdate);
      const text = [
        `# Crawl result\n\nStatus: ${job.status}\nPages: ${job.completed}\nCredits used: ${job.creditsUsed ?? "unknown"}`,
        ...job.data.map((document, index) => formatDocument(document, index)),
      ].join("\n\n");
      return boundedOutput(text, `crawl-${started.id}`);
    },
  });
}
