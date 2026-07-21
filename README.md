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
- lowercase `rhubarb` gradient header and a two-line model/context/Git dashboard footer

Git commands and clipboard helpers are planned next.

## Security

Pi extensions execute with the current user's permissions. Credentials, sessions, environment files, and runtime state are excluded from version control.

## License

MIT
