# Project conventions

Strict layering: **all logic lives in `src/lib/`; the presentation layers
(`src/app/`, `src/cli/`, `src/components/`) only present.**

## Read the right doc before writing code
- **Before scaffolding, or adding/changing any logic:** read `./ARCHITECTURE.md` and follow it.
- **Before building any UI element:** read `./components.md` (the reusable-component registry) and reuse what already fits.
- **Before styling any UI (colors, type, buttons, cards) or building a new module's view:** read `./design.md` and follow it — colors and fonts are theme tokens, not literal values.
- **Creating a new reusable component:** start from `./src/components/_component-template.tsx`.
- **Before adding a table, column, or schema change:** read `./coding-guide.md` (table naming, migration conventions).

## Plan before building — wait for approval
Before writing any code for a new feature, module, or multi-file change: read
`./ARCHITECTURE.md` and the closest existing module, then present a plan covering

1. **Files** you'll create and modify, listed by path.
2. **Migration + `DEFAULT_MODULES`** changes — the numbered `.sql` and its `.md` log,
   any new table's 3-letter prefix, and whether a new module needs registering.
3. **Third-party services and dependencies** you'd add, and **whether each is free**.
   Never build on a paid or metered API without asking first.
4. **Open questions** about the requirements — anything where two readings would
   produce materially different work.

Then stop and wait. Don't start implementing, and don't fold the plan into the first
edit. Exempt: single-file fixes, typos, renames, and mechanical shell commands — plan
those in a sentence and get on with it.

## Always-on rules (full detail in ARCHITECTURE.md)
- Business logic goes in `src/lib/` as functions that take data and return data — never in a `.tsx`, a route, or a CLI command.
- Nothing under `src/lib/` may import from `react` or `next`.
- Every use-case must be callable identically from the web app and the CLI. Validate boundary input with the module's zod schema.
- New library logic ships with a colocated Vitest test (success + failure paths) — except flagged one-offs.
- UI is reuse-first. If something looks reusable and isn't in `components.md`, ask *"should this be reusable? give it a name,"* then create it in `src/components/` and register it.
- Don't gold-plate a one-off: write the simple version and say so in one line.

## Verify before reporting done
After any multi-file change, run **`/verify`** (or `npm run verify`) and fix what it
reports, looping until every stage is green. **Do not report a change as complete while
a gate is red** — say what's failing instead.

The stages, cheapest first: typecheck → lint + library boundary → unit tests →
migration dry-run against a *copy* of the dev DB → Playwright sweep of every route on a
fresh dev server with `.next` cleared. Details in `./.claude/commands/verify.md`.

Two things that have wasted real time and are now handled by the gate rather than by
memory:
- **A UI change that "isn't taking effect" is a stale `.next` cache until proven
  otherwise.** Clear it (`npm run clean:next`) and hard-reload before hunting for a bug.
- **No gate may touch the real database.** Copies live in `.verify/`; the copy step
  aborts if `MYHOMEBASE_DB` is unset or points inside the repo's `data/` folder.

## Stack
Next.js App Router + TypeScript. Path alias `@/* -> src/*` (set in `tsconfig.json`).
