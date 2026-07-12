# MyHomeBase — start here

An empty Next.js project pre-loaded with the conventions Claude Code should follow.
Nothing is scaffolded yet — that's the first task.

## What's in here
- `CLAUDE.md` — read automatically by Claude Code every session; points to the docs below.
- `ARCHITECTURE.md` — the architecture contract (logic in `lib/`, thin presentation, UI/CLI parity, testing, one-offs).
- `components.md` — the reusable-UI-component registry, checked before building any UI.
- `_component-template.tsx` — the starting point for new reusable components.
- `docs/reference/create-user-example/` — a small runnable example of the pattern.
  **Illustrative only — not part of the app.** Keep it as a reference or delete it.

## To start
1. Install prerequisites: Node 20+, and Claude Code (`npm install -g @anthropic-ai/claude-code`).
2. From this folder, run: `claude`
3. Paste the scaffolding prompt below.

## Scaffolding prompt (paste into Claude Code)

> Read CLAUDE.md, ARCHITECTURE.md, and components.md fully before doing anything.
>
> This repo is an empty Next.js app called **MyHomeBase**. Scaffold the initial project
> to match ARCHITECTURE.md — **structure and enforcement only, no features yet.**
>
> 1. Initialize a Next.js App Router + TypeScript project in the current directory: use
>    the `src/` directory and the `@/* -> src/*` import alias, and include ESLint and
>    Tailwind. Keep the existing `.md` docs, `_component-template.tsx`, and `docs/`
>    folder. Set the package name to `myhomebase`.
> 2. Create the layer skeleton from ARCHITECTURE.md:
>    - `src/lib/` with `shared/` and `wiring.ts` (composition root, empty for now).
>    - `src/components/` and move `_component-template.tsx` into it.
>    - `src/cli/` with `index.ts` (a command router with no commands registered yet).
>    - a minimal `src/app/` home page that renders "MyHomeBase" and nothing else.
> 3. Wire up enforcement:
>    - ESLint `no-restricted-imports` scoped to `src/lib/**` banning `react`, `next`,
>      and `next/*`.
>    - Vitest, with a `test` script and config picking up `src/**/*.test.ts`.
>    - Add the CI grep backstop (`! grep -rE "from '(react|next)" src/lib`) as an npm script.
> 4. Verify the skeleton is green: run typecheck, lint, and the (empty) test suite; fix
>    anything red.
> 5. Stop and show me the resulting file tree and the key config files. **Do not build
>    any domain features or UI components yet** — I'll direct those next.
>
> Follow the one-off and reuse rules throughout: don't gold-plate, and don't create any
> components beyond the template at this stage.
