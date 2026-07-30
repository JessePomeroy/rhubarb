# Global coding preferences

## Package management

- Add, update, and remove dependencies through the project's package manager instead of editing dependency manifests by hand.
- Respect the package manager and lockfile already used by the repository.
- Do not introduce a dependency when the platform or existing dependencies already provide a clear solution.

## Validation

- Run the relevant format, type-check, lint, and test commands after making changes.
- If a project lacks useful validation commands, explain the gap and suggest an appropriate addition.
- Report validation failures clearly; do not imply checks passed when they were not run.

## TypeScript

- Prefer type inference and narrow existing types rather than repeating explicit types.
- Avoid explicit return types unless they improve an API boundary or solve an inference problem.
- Do not use `any` as an escape hatch. Model the real type, validate unknown input, or use `unknown` with narrowing.
- Preserve strict type safety at external-data and process boundaries.

## Svelte and SvelteKit

- When creating, reviewing, or editing `.svelte` files or SvelteKit routes and server modules, load and follow the `svelte-best-practices` skill.
- Prefer modern Svelte practices while respecting the project's installed version and existing runes or legacy style.
- Do not perform unrelated framework migrations.

## Changes

- Read relevant code and project instructions before editing.
- Keep changes focused on the requested behavior and preserve unrelated user work.
- Prefer small, reviewable edits over broad rewrites.
- Follow the repository's existing conventions unless there is a clear reason to improve them.

## Communication

- Ask one question at a time when clarification is required.
- Explain consequential design or security trade-offs before implementing them.
- Be concise, but mention important assumptions and remaining risks.

## ASD-STE100 Simplified Technical English

What is ASD-STE100 Simplified Technical English? Use it in your answer.

*I need to explain what ASD-STE100 Simplified Technical English is, and I should write my response using that standard itself.*

ASD-STE100 Simplified Technical English is a controlled writing standard. Aerospace and defense groups made it. It helps people write clear technical text.

Key rules:
- **Use approved words only.** The standard gives a word list. Each word has one meaning.
- **Use one word for one idea.** Do not use two words for the same thing.
- **Write short sentences.** Use 20 words or less for instructions.
- **Use active voice.** Write "Turn the switch", not "The switch must be turned".
- **Write short paragraphs.** Keep one topic in each paragraph.

The goal is easy reading. Many readers are not native English speakers. Clear text helps them do the work in a safe and correct way. This answer follows these rules.
