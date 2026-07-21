---
name: svelte-best-practices
description: Apply modern Svelte 5 and SvelteKit conventions when creating, reviewing, or editing .svelte files and SvelteKit routes, load functions, form actions, hooks, or server modules.
---

# Svelte best practices

## Establish project context first

1. Inspect `package.json`, Svelte/SvelteKit versions, configuration, and nearby components.
2. Follow the project's established runes or legacy style. Do not migrate unrelated legacy components merely because Svelte 5 is installed.
3. Use generated route types from `./$types` and preserve the project's formatter, linter, test, and package manager choices.

## Svelte 5 components

For new Svelte 5 components, prefer runes mode:

- Use `$state` only for values whose changes must update a template, `$derived`, or `$effect`.
- Use `$state.raw` for large objects or arrays that are replaced rather than deeply mutated.
- Compute values with `$derived` or `$derived.by`; do not synchronize derived state through `$effect`.
- Treat `$effect` as an escape hatch for external side effects. Avoid updating state from effects and always clean up subscriptions, observers, and timers.
- Declare typed props with `$props`; use `$bindable` only when two-way binding is intentional.
- Prefer callback props over `createEventDispatcher` and snippets over legacy slots in runes-mode components.
- Keep component state local unless it genuinely needs to be shared. Use context or `.svelte.ts` state modules deliberately.

## SvelteKit boundaries

- Keep secrets, privileged credentials, and database access in server-only modules (`+page.server`, `+layout.server`, `+server`, or `$lib/server`).
- Use server `load` functions for private data and universal `load` functions only when browser execution is safe and useful.
- Avoid unnecessary `await parent()` calls because they create loading waterfalls.
- Prefer form actions for ordinary data mutations and progressive enhancement. Use remote functions only when the installed SvelteKit version and project configuration intentionally adopt them.
- Use `error` and `redirect` according to SvelteKit control flow; do not accidentally catch redirects.
- Validate all untrusted form, URL, cookie, and endpoint input at the server boundary.
- Preserve SSR safety: guard browser-only APIs and do not introduce hydration-dependent behavior without need.

## Markup and accessibility

- Prefer semantic HTML before ARIA.
- Keep labels, keyboard behavior, focus handling, and error messaging accessible.
- Use keyed each blocks only when identity matters.
- Avoid unnecessary wrapper elements and component abstractions.

## Validation

Run the repository's relevant formatting, `svelte-check`, type-check, lint, unit, and browser tests after changes.

## Official references

- https://svelte.dev/docs/svelte/best-practices
- https://svelte.dev/docs/svelte/v5-migration-guide
- https://svelte.dev/docs/kit/load
- https://svelte.dev/docs/kit/form-actions
- https://svelte.dev/docs/kit/remote-functions
