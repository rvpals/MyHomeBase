# Architecture — Read Before Scaffolding

This is the contract for how this codebase is structured. It applies to every file
you generate. If a request conflicts with these rules, stop and flag it rather than
bending the structure.

## Core principle

**All logic lives in the library. The presentation layer only presents.**

- The **library** (`src/lib/`) is a plain TypeScript project. It holds every piece of
  business logic, domain model, validation, calculation, and data access. It does not
  know that Next.js or React exist.
- The **presentation layer** is any front-end that drives the library. There is more
  than one: the Next.js app (`src/app/`) and a command-line interface (`src/cli/`) are
  peers. Each fetches by calling library functions, formats the result for its medium,
  and contains no business rules.

A library function must behave **identically whether it's called from the UI or the
command line** — same inputs, same outputs, same side effects. The only difference is
how each front-end reads its input and displays the result. This is the litmus test
for the whole design: if a use-case can't be driven from a terminal without touching
`lib/`, logic has leaked into presentation.

If you can't decide where something goes, ask one question: *would this still make
sense in a CLI, a cron job, or a test with no browser?* If yes, it belongs in `lib/`.

## The one hard rule (this is enforceable, not aspirational)

> **No file under `src/lib/` may import from `react`, `next`, or `next/*`.**

This single invariant operationalizes everything above. It's greppable and lint-able,
so treat a violation as a build failure, not a style nit. If library code seems to
"need" React or Next, the logic has leaked into the wrong layer — extract it.

## Directory layout

```
src/
  lib/                       # THE LIBRARY. Pure TS. No react/next imports. Fully unit-testable.
    <domain>/                # one folder per domain concept (e.g. portfolio, auth, samples)
      types.ts               # domain models & interfaces
      schema.ts              # zod schemas — the single source of truth for shapes
      <domain>.ts            # use-cases / business logic. Depend on a repo interface, not a concrete one.
      repository.ts          # data access impl (db, http, fs). Returns domain types, not raw rows.
      ports.ts               # the interface(s) a use-case needs (e.g. PortfolioRepository)
      index.ts               # the public surface of this module — import from here, not internals
      <domain>.test.ts       # unit tests, colocated with the code they cover
    shared/                  # cross-cutting pure helpers (dates, money, result types)
    wiring.ts                # composition root: builds real deps and hands them to use-cases

  app/                       # PRESENTATION (web). Next.js App Router. Renders only.
    <route>/
      page.tsx               # server component: calls lib, passes plain data to the view
      view.tsx               # (or components/) route-local presentation. One-off UI lives here.
      loading.tsx            # loading UI
      error.tsx              # error UI
    api/<route>/route.ts     # thin adapter: parse request -> call lib -> serialize response
    actions.ts               # server actions: thin adapter: validate input -> call lib

  components/                # REUSABLE UI. Pure presentation, registered in components.md.
    <component-name>.tsx     # props in, events out. No fetching, no business logic.

  cli/                       # PRESENTATION (terminal). Peer of app/. Same use-cases, different I/O.
    index.ts                 # command router (argv -> command)
    <command>.ts             # thin adapter: parse args -> validate with lib schema -> call lib -> print
```

Everything else (config, tests, scripts) sits at the repo root as usual.

## What goes in the library

- Domain types and the `zod` schemas that define/validate them.
- Business rules, calculations, transformations — written as pure functions that take
  data and return data. No hidden I/O inside a "pure" function.
- Data access, isolated in `repository.ts` files. A repository is the *only* place that
  talks to a DB or an external API, and it always returns domain types, never raw
  driver rows or untyped JSON.
- **Use-cases depend on a repository *interface* (`ports.ts`), not the concrete class.**
  The real repository is wired in at `wiring.ts` (the composition root); tests wire in a
  fake. This is what lets the same use-case run under the web app, the CLI, and a unit
  test without change.
- The public API of each domain module, exposed through its `index.ts`. Other modules
  import from `lib/<domain>`, never from a file deep inside it.

## What goes in the presentation layer

- Rendering. Components receive fully-formed data as props and display it.
- Routing, layouts, metadata.
- Loading and error states.
- Form wiring and event handling — but the handler's job is to *call a library
  function or server action*, not to compute anything itself.
- Client-side view state only (open/closed, hovered, selected). Not domain state.

A presentational component should have no idea *how* its data was produced.

## How the Next.js glue stays thin

These are the only places Next.js touches the library, and each is an adapter — a few
lines that translate between the framework and `lib/`:

- **Server Components (`page.tsx`)**: `await` a library function, hand the result to a
  view. No fetching logic, no branching business rules in the component body.
- **Route Handlers (`api/*/route.ts`)**: parse and validate the request with a `lib`
  schema, call a `lib` function, serialize the return value. If a handler is longer
  than ~15 lines, logic has leaked into it.
- **Server Actions (`actions.ts`)**: validate input with a `lib` schema, call a `lib`
  use-case, return its result. The action does not implement the use-case.
- **Middleware**: routing and auth gating only. Auth *decisions* come from a `lib`
  function; middleware just enforces the answer.

## UI and CLI do the same thing

The web app and the CLI are two adapters over one library. Every use-case is reachable
from both, and a given logical input produces the same result in both.

- Both adapters use the **same `lib` schema** to parse their raw input (form data /
  request body on the web, argv/stdin on the CLI) into the same typed input object.
- Both call the **same use-case** with that input.
- They differ *only* in I/O: the web adapter returns JSON or renders a view; the CLI
  adapter prints to stdout and sets an exit code.

Concretely, one use-case, two callers:

```ts
// lib/portfolio/portfolio.ts — the single source of behavior
export async function rebalance(input: RebalanceInput, repo: PortfolioRepository) { ... }

// app/actions.ts — web adapter
export async function rebalanceAction(form: FormData) {
  const input = rebalanceSchema.parse(Object.fromEntries(form));
  return rebalance(input, deps.portfolioRepo);        // same call
}

// cli/rebalance.ts — cli adapter
export async function rebalanceCommand(argv: string[]) {
  const input = rebalanceSchema.parse(parseArgs(argv));
  const result = await rebalance(input, deps.portfolioRepo);  // same call
  console.log(format(result));
}
```

Rule: **adding a CLI command for an existing use-case must require zero changes to
`lib/`.** If it doesn't, the use-case was carrying presentation assumptions — fix the
use-case, not the CLI. Payoff: the CLI is how you drive real logic in CI and in
manual debugging without a browser, and it doubles as an integration smoke test.

## Modules

A module is one domain concept (`portfolio`, `auth`, `samples`), and it owns everything
about that concept: its types, schema, use-cases, ports, and repository.

- **Talk through the front door.** A module is used only via its `index.ts`. Never
  import another module's internal files.
- **No cycles.** If module A imports B and B imports A, the shared piece belongs in
  `shared/` or in a new module both depend on. Dependencies between modules must form
  a DAG.
- **Cohesion test.** Everything about a concept lives in its module; nothing about it
  leaks elsewhere. A stray "portfolio" calculation sitting in `app/` or `shared/` is a
  smell.
- **The package test.** A well-drawn module could be lifted into its own workspace
  package by changing only import paths. If that would be painful, the boundaries are
  wrong.

## One-offs — don't gold-plate, but say when you're taking a shortcut

The rules above are the default, not a mandate to wrap every five-line helper in a port,
a barrel, a repository, and a test suite. If something is genuinely used once and isn't
domain logic worth reusing, write the plain version and move on. Over-building a one-off
is as much a mistake as hiding logic in a component.

Use judgment, and match the flag to the situation — don't ask about everything, that's
just a different kind of over-thinking:

- **Trivial and view-local** (formatting a label for one screen, sorting a list for one
  table): write it inline in the presentation layer. No module, no flag.
- **Clearly reusable domain logic**: put it in a module. No flag — just do it.
- **The ambiguous middle** — it *might* be domain logic, but you judge it a one-off:
  write the simple standalone function (a plain `lib` function is fine; skip the ports /
  barrel / repository apparatus) and say so in one line, e.g. *"Wrote `computeX` as a
  one-off since nothing else uses it — I can promote it to a module later if that
  changes. OK?"* For something cheap to move later, note it and keep going; don't stall
  the work waiting for an answer.

**Promote on the second caller.** A one-off that gets a second user is no longer a
one-off — that's the moment to lift it into a proper module with a test, not before.
Even a shortcut one-off still respects the layer boundary: real logic goes in a `lib`
function, not buried inside a `.tsx` or a CLI command.

## Reusable UI components

UI gets the same reuse discipline as logic, tracked in **`components.md`** (the registry
and source of truth for what reusable components exist and what they're named).

**Reuse first.** Before building any UI element, check `components.md`. If a registered
component fits, import it from `src/components/` and use it. Do not rebuild something
that already exists under a different name.

**Ask before creating a new reusable one.** When you're about to build something that
looks reusable — a card, modal, table, form field, badge, and nothing in the registry
fits — pause and ask, in one line:

> "This looks reusable — should we make it a shared component? If so, give it a name."

Wait for the name. When told (e.g. *"call it collapsible card"*), create it at
`src/components/collapsible-card.tsx` (kebab-case file, `CollapsibleCard` export) and
add a row to `components.md`. Register it once; from then on it's reused, not rebuilt.

**One-off UI stays local — don't ask about everything.** Page-specific layout that
won't be reused lives in the route's `view.tsx`, exactly like a one-off function. Only
raise the prompt for things that plausibly recur; obviously trivial local markup just
gets written.

**Reusable components are pure presentation.** Props in, events out. No data fetching,
no business logic, no `lib` imports beyond types. A component that needs data receives
it as props from the page that fetched it.

**Consistency.** New shared components follow the conventions of the ones already in the
registry — same styling approach, prop-naming, and variant patterns. Start from the
component template rather than from scratch.

## Data flow is one direction

```
app/ (render, events)  ->  lib/<domain> use-case  ->  lib/<domain> repository  ->  data source
        ^                                                                              |
        +------------------------ domain types flow back up --------------------------+
```

Presentation depends on the library. The library never depends on presentation.

## Unit testing the library

Because the library has no framework imports and its use-cases receive their
dependencies, it's tested with plain, fast unit tests — no render harness, no mocked
router, no database.

- **Runner:** Vitest. Colocate tests as `<name>.test.ts` next to the code they cover,
  inside the module. Run the whole suite with `npm test` and a single module with a
  path filter.
- **What to test, and how much:**
  - *Pure functions* (calculations, transforms, formatting rules): test directly with
    plain inputs and asserted outputs, including edge cases and boundaries. Cover these
    thoroughly — they hold the real logic.
  - *Use-cases*: call the function with a **fake repository** that implements the
    module's port (an in-memory object). Assert the returned domain result and any
    calls made to the fake. No real I/O.
  - *Schemas*: test that `schema.parse` accepts valid shapes and rejects invalid ones —
    this is the boundary that protects every adapter, so it's worth explicit cases.
  - *Repositories*: not unit-tested against a live source. If they need coverage, that's
    a separate, clearly-labeled integration test, not part of the unit suite.
- **Fakes over mocks.** Prefer a hand-written in-memory implementation of a port over a
  mocking framework. It's readable, reusable across a module's tests, and doesn't couple
  tests to call order.
- **Presentation is barely tested.** Components get light tests only for interaction
  wiring (does clicking call the action?), never for logic — there shouldn't be any
  logic there to test. The CLI adapter is exercised for arg-parsing and exit codes only;
  the behavior it invokes is already covered in the library.
- **Definition of tested:** every new use-case ships with tests for its success path and
  its meaningful failure paths, using a fake repository. A PR that adds library logic
  without tests is not done. (A flagged one-off is exempt until it gets promoted — then
  it gets tests as part of the promotion.)

## Anti-patterns — do not generate these

- A `fetch()`, DB call, or price/score/date calculation inside a `.tsx` file.
- A `page.tsx` with `if/else` business branching. Move the decision into a use-case.
- A "utils" dump under `app/` that quietly accumulates domain logic.
- Repositories returning raw rows / `any` to the caller.
- A use-case that imports a concrete repository directly instead of receiving its port.
- A use-case that behaves differently, or is unreachable, from the CLI vs the web app.
- Business logic living in a CLI command instead of in `lib/`.
- Importing from another module's internals (`lib/portfolio/repository`) instead of its
  `index.ts`; import cycles between modules.
- A new use-case with no tests, or logic tested through the UI instead of directly.
- Rebuilding a UI element that's already registered in `components.md`, or under a
  new name.
- A shared component in `src/components/` that fetches data or holds business logic.
- Creating a reusable component without registering it (or registering one that doesn't
  exist).
- Any `react`/`next` import inside `src/lib/`.

## Definition of done for any change

1. New business logic landed in `src/lib/`, not in a component, route, or CLI command.
2. No `react`/`next` imports were added under `src/lib/`.
3. Inputs crossing a boundary (routes, actions, CLI commands) are validated with a `lib`
   schema.
4. The use-case is reachable and behaves identically from both the web app and the CLI.
5. New library logic ships with colocated unit tests (success + failure paths) using a
   fake repository — unless it's a flagged one-off.
6. Presentation changes only touched rendering, events, and view state.
7. If you wrote something as a one-off instead of a module, you said so in one line.
8. UI reuse was checked against `components.md` first; any new shared component is
   registered there.
9. The change is a small, reviewable diff.

## Suggested enforcement (wire this up early)

- ESLint `no-restricted-imports` scoped to `src/lib/**` banning `react`, `next`,
  `next/*` — turns the hard rule into a failing lint.
- A CI grep as a backstop:
  `! grep -rE "from '(react|next)" src/lib`
- Keep this file at the repo root and reference it from `CLAUDE.md` so the agent reads
  it before scaffolding. Reference `components.md` from `CLAUDE.md` too, so the registry
  is consulted before any UI is built.
