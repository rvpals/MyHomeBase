# Project conventions

Strict layering: **all logic lives in `src/lib/`; the presentation layers
(`src/app/`, `src/cli/`, `src/components/`) only present.**

## Read the right doc before writing code
- **Before scaffolding, or adding/changing any logic:** read `./ARCHITECTURE.md` and follow it.
- **Before building any UI element:** read `./components.md` (the reusable-component registry) and reuse what already fits.
- **Before styling any UI (colors, type, buttons, cards) or building a new module's view:** read `./design.md` and follow it — colors and fonts are theme tokens, not literal values.
- **Creating a new reusable component:** start from `./src/components/_component-template.tsx`.

## Always-on rules (full detail in ARCHITECTURE.md)
- Business logic goes in `src/lib/` as functions that take data and return data — never in a `.tsx`, a route, or a CLI command.
- Nothing under `src/lib/` may import from `react` or `next`.
- Every use-case must be callable identically from the web app and the CLI. Validate boundary input with the module's zod schema.
- New library logic ships with a colocated Vitest test (success + failure paths) — except flagged one-offs.
- UI is reuse-first. If something looks reusable and isn't in `components.md`, ask *"should this be reusable? give it a name,"* then create it in `src/components/` and register it.
- Don't gold-plate a one-off: write the simple version and say so in one line.

## Stack
Next.js App Router + TypeScript. Path alias `@/* -> src/*` (set in `tsconfig.json`).
