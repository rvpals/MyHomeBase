# Project conventions

Strict layering: **all logic lives in `src/lib/`; the presentation layers
(`src/app/`, `src/cli/`, `src/components/`) only present.**

## Read the right doc before writing code
- **Before scaffolding, or adding/changing any logic:** read `./ARCHITECTURE.md` and follow it.
- **Before building any UI element:** read `./components.md` (the reusable-component registry) and reuse what already fits.
- **Before styling any UI (colors, type, buttons, cards) or building a new module's view:** read `./design.md` and follow it — colors and fonts are theme tokens, not literal values.
- **Before adding or moving any navigation/chrome element:** read `./design.md` →
  *Navigation: the tree (desktop) and the two-tier bar (compact)* and *Adding a UI element
  to the shell*. Desktop navigation is **one 260px tree** (`NavTree`) carrying Home, every
  module and every section, above a filter box; compact keeps the **two-tier bottom bar**
  (`SectionPanel`). Put the control where it belongs and never hand-roll a new `fixed` bar.
  **The two layouts are deliberately different shapes — don't "fix" the inconsistency.**
- **`ModuleRail` has no call site.** The tree replaced it. It is kept one release as a
  cheap revert; restyling it will not change any screen. Same trap as `TreeNav`.
- **A new module never builds its own navigation.** Declare `sections`, add one entry to
  `src/app/(protected)/module-sections.ts`, and pass `tree`/`expandedModules`/
  `onExpandedChange`/`adminTreeModule` from `getNavTreeData` to `TwoTierShell` — copy the
  four lines from `journal-shell.tsx`. `sections` still feeds the compact bar and the
  breadcrumb; the tree feeds the desktop column; **both are required.** Read
  `./design.md` → *What compact does differently* and `./modules.md` → step 7. Adding a
  bottom tab row or a compact-only nav to a module is the fastest way to break a phone
  layout here: the bottom edge is already claimed by the shared bar and the music player.
- **Before adding anything that floats over the page** (a clock, a calculator, a
  now-playing accessory): read `./design.md` → *The floating layer* and `./coding-guide.md`
  → *The floating layer*. The shell's four surfaces are a **closed list** — a new floating
  thing registers in `FLOATING_COMPONENTS` and renders in `FloatingLayer`, it never invents
  a fifth surface or a fresh `fixed bottom-0`. Nothing about *where you are* may float;
  that belongs in a navigation tier. **Floating ids are permanent once shipped** (they're
  persisted in the enabled list and in each reader's state rows) — same rule as icon slots.
- **Creating a new reusable component:** start from `./src/components/_component-template.tsx`.
- **Before adding a table, column, or schema change:** read `./coding-guide.md` (table naming, migration conventions).
- **Before adding any icon to a new screen, card, or nav:** read `./coding-guide.md` →
  *Icons: use a slot, not a bare glyph name*. Icons that mark a **place** go through
  `SlotIcon` + a registered slot, never `<TreeIcon name="…">` at the call site; row
  actions and state glyphs deliberately stay as they are. **Propose the slot ids and
  labels and wait for confirmation** — ids are permanent once uploads exist.
- **Before creating a new module, or changing a module's slug/names/icon/sections:** read `./modules.md` (the module registry and the step-by-step recipe).

## Plan before building — wait for approval
Before writing any code for a new feature, module, or multi-file change: read
`./ARCHITECTURE.md` and the closest existing module, then present a plan covering

1. **Files** you'll create and modify, listed by path.
2. **Migration + `DEFAULT_MODULES`** changes — the numbered `.sql` and its `.md` log,
   any new table's 3-letter prefix, and whether a new module needs registering.
3. **Icon slots** — if the work adds any screen, card, or nav that shows an icon, the
   proposed slot ids, labels and `where` descriptions as a table, plus anything you chose
   *not* to slot and why. Ids are persisted and can't be renamed later without orphaning
   a user's upload, so these get confirmed with the plan, not after.
4. **Third-party services and dependencies** you'd add, and **whether each is free**.
   Never build on a paid or metered API without asking first.
5. **Open questions** about the requirements — anything where two readings would
   produce materially different work.

Then stop and wait. Don't start implementing, and don't fold the plan into the first
edit. Exempt: single-file fixes, typos, renames, and mechanical shell commands — plan
those in a sentence and get on with it.

## Always-on rules (full detail in ARCHITECTURE.md)
- Business logic goes in `src/lib/` as functions that take data and return data — never in a `.tsx`, a route, or a CLI command.
- Nothing under `src/lib/` may import from `react` or `next`.
- Every use-case must be callable identically from the web app and the CLI. Validate boundary input with the module's zod schema.
- **Every exported server action authorises on its first line** —
  `requireModuleAccess(<FULL_SLUG>)` for anything a module owns, else
  `requireAdmin()` / `requireUser()`, from `src/app/(protected)/require-access.ts`.
  An action is its own POST endpoint, so no layout or page check protects it. Match
  the module's **full slug exactly** — never a prefix, never a route path.
- New library logic ships with a colocated Vitest test (success + failure paths) — except flagged one-offs.
- UI is reuse-first. If something looks reusable and isn't in `components.md`, ask *"should this be reusable? give it a name,"* then create it in `src/components/` and register it.
- **Every UI change must work on a phone and on a desktop.** One boundary,
  1024px. Restyle with `max-lg:` variants first — they leave the desktop classes
  untouched, so wide screens provably can't regress. Only when the small screen
  needs a genuinely *different component* (not a restyled one) read the layout
  from `useViewport()` / `useIsCompact()`. Full rules in `./design.md`; don't
  ship a new screen without saying how it behaves narrow.
- Don't gold-plate a one-off: write the simple version and say so in one line.

## Report done honestly — don't run the gates
**Never run a quality gate unless Min explicitly asks.** That means no `tsc`/typecheck,
no `eslint`/lint, no `vitest`/unit tests, no migration dry-run, no `/verify`, no
`npm run verify`, and no Playwright or any other browser/e2e run — **ever**, including
"just to check before reporting". Don't offer one either; if a gate would help, finish
the work and say so in one line.

Min runs the gates and tests the UI himself. The gates still exist (`/verify`,
`npm run verify`, `./.claude/commands/verify.md`) — they are **his** to invoke, not
something to reach for unprompted.

This rule overrides any instinct to "verify before reporting done", and it overrides
the rest of this file. It exists because running them unasked has repeatedly burned
minutes on a machine where the suite is slow and the real database lives on a NAS.

**Instead, report honestly.** Close a change by naming:
1. **Every file** created or modified, by path.
2. **What you did not verify** — say it plainly rather than implying it works.
3. **Anything you're unsure landed**, especially a wiring step with no visible output.

Never describe a change as working, passing, or verified on the strength of having
written it. *"I wrote it earlier"* is not verification, and neither is *"it should
compile."* If you have grounds to believe something works, name them; if you don't,
say that.

Two things that have wasted real time and are still worth reading before you touch
the relevant code:
- **A UI change that "isn't taking effect" is a stale `.next` cache until proven
  otherwise.** Clear it (`npm run clean:next`) and hard-reload before hunting for a bug.
  The same cache also breaks *builds*: `tsconfig.json` typechecks `.next/dev/types/**`,
  and those dev-generated route types outlive a deleted page — so a build can fail
  naming a file that no longer exists. `verify` and `build` both clear `.next` first now.
- **Nothing may touch the real database.** The live DB is on the NAS
  (`//NAS_DS223/app/myhomebase/data/`); `C:\webapp` and the repo's `data/` are stale
  copies and are never the live state. When Min runs a gate, its copies live in
  `.verify/` and the copy step aborts if `MYHOMEBASE_DB` is unset or points inside
  the repo's `data/`. Never point a script, a query or a migration at the real file.
- **Before restyling a component, prove where it renders.** `grep -rn "<ComponentName"
  src/` and name the screens it appears on. A mention in a comment, in `components.md`,
  or in an import is **not** evidence — only a JSX call site is. Shared components get
  migrated away from and the stale references stay behind: `TreeNav` reads like the app's
  tree navigation, but every module moved to `SectionPanel` and its only remaining call
  sites are the two in Admin → SQL Explorer. A restyle was shipped to it that no screen
  the reporter was looking at could ever show. **If you can't name the screen, you have
  no grounds to say the change works.**
- **Uncommitted work in the tree is unverified work — including your own.** A previous
  session's changes carry no proof they were ever seen on screen, and across sessions
  there is no memory of what was checked. Before `/release` stages a change nobody has
  looked at this session, locate its call sites as above. Documented ≠ finished ≠ wired
  up, and *"I wrote it earlier"* is not verification.

## Stack
Next.js App Router + TypeScript. Path alias `@/* -> src/*` (set in `tsconfig.json`).
