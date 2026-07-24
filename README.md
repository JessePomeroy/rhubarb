# rhubarb

A personal, public [pi](https://pi.dev) configuration focused on:

- subagents
- reusable workflows
- Firecrawl-powered web research
- background terminal management
- structured user questions
- fast file and content search
- a useful, compact terminal interface

This project is being built intentionally from pi's public extension APIs and documentation. Features are added after deciding how they should fit this workflow rather than copying another setup wholesale.

## Included

- Firecrawl web search, single-page scraping, and bounded site crawling
- Asynchronous pi and Codex subagents
- `/subagents` management and takeover UI
- `/btw` side-question agents
- sandboxed ultracode workflows with structured outputs, background execution, artifacts, and `/workflows`
- session-scoped background terminals with process-group cleanup and `/ps`
- structured multiple-choice user questions with a free-form fallback
- first-class `fd` and `rg` tools with verified portable binary fallback
- a complete Catppuccin Mocha terminal theme
- lowercase `rhubarb` ASCII-art header and a two-line model/context/Git dashboard footer
- `/lg`, `/pr`, and cross-platform `/copy-all` convenience commands

## Documentation

- [Installation and recovery](SETUP.md)
- [Architecture and usage](ARCHITECTURE.md)

## Development

```bash
npm install
npm run format:check
npm run check
npm test
npm audit --omit=dev
```

## Security

Pi extensions execute with the current user's permissions. Credentials, sessions, environment files, workflow artifacts, and runtime state are excluded from version control. Workflow orchestration JavaScript has an additional restricted child-process boundary described in [ARCHITECTURE.md](ARCHITECTURE.md).

## License

MIT
