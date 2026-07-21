# Firecrawl extension

Provides three model tools:

- `firecrawl_search` for web and news results
- `firecrawl_scrape` for a single page
- `firecrawl_crawl` for a bounded multi-page crawl

## Authentication

Set `FIRECRAWL_API_KEY` in the process environment or create
`~/.pi/agent/.env`:

```dotenv
FIRECRAWL_API_KEY=fc-your-key
```

Keep the file private with `chmod 600 ~/.pi/agent/.env`. The repository ignores
`.env` files.

## Crawl policy

Crawls default to 10 pages and have a hard limit of 100. A running crawl is
cancelled when the pi tool call is aborted or after five minutes.

Tool output follows pi's 50 KB/2,000-line limits. Full oversized output is
written to a mode-`600` temporary Markdown file and its path is returned.
