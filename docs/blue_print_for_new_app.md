# Blueprint for a new app — scaffolding instructions for Claude Code

**How to use this file.** Copy it into an empty repo (as `BLUEPRINT.md`), start Claude Code there,
and say: *"Read BLUEPRINT.md and scaffold the project. Follow the phases in order and stop at each
checkpoint."* Everything below is distilled from MyHomeBase (Next.js + TypeScript + SQLite, ~410k lines,
built almost entirely with Claude Code). Paths cited as `MyHomeBase: …` are where the original lives.

> **Instructions to Claude (the reader of this file):**
> 1. Fill every `{{PLACEHOLDER}}` by asking the user once, up front (Phase 0). Do not invent values.
> 2. Work phase by phase. At every **CHECKPOINT**, stop, report, and wait.
> 3. Never skip a guardrail to save time. Each one exists because of a real incident.
> 4. Do not add a paid or metered service without asking. State whether each dependency is free.
> 5. When done with a phase, report: files created, what you did **not** verify, anything you are unsure landed.

---

## 0. Decisions to collect first

Ask the user for these in one message. Offer the default in brackets.

| Placeholder | Meaning | Default |
|---|---|---|
| `{{APP_NAME}}` | kebab-case repo/package name | — |
| `{{DB_ENV}}` | env var holding the DB path | `{{APP_NAME_UPPER}}_DB` |
| `{{AUTH}}` | session auth needed? (yes/no) | yes |
| `{{FEATURE_UNIT}}` | what a top-level feature is called ("module", "area") | module |
| `{{FIRST_DOMAIN}}` | first real domain to build as the reference example | — |
| `{{PROD_DATA}}` | where production data lives (path/host) | — |
| `{{CI}}` | CI provider | GitHub Actions |
| `{{OS}}` | developer OS (affects scripts) | Windows + macOS/Linux |
| `{{CLI_NEEDED}}` | ship a CLI front-end? | yes |

Also ask: expected number of users (single-user changes how much auth to build), whether a phone layout is required.

---

## 1. General principles (put these in `docs/ARCHITECTURE.md`)

1. **Logic lives in `src/lib/`; presentation only presents.** The web app (`src/app/`), the CLI (`src/cli/`)
   and UI components (`src/components/`) contain no business rules.
2. **One hard, machine-checked rule:** no file under `src/lib/` imports `react`, `next`, or `next/*`.
   If lib seems to need them, the logic is in the wrong layer.
3. **Litmus test:** *would this still make sense in a CLI, a cron job, or a test with no browser?* If yes, it belongs in `lib/`.
4. **Use-cases depend on interfaces (`ports.ts`), not concrete repositories.** A single composition root
   (`src/lib/wiring.ts`) builds the real ones. Tests inject fakes.
5. **Validate every boundary with a zod schema** that lives in lib and is the single source of shapes.
6. **Parity:** every use-case is callable identically from the web app and the CLI.
7. **Authorise on the first line of every server action.** An action is its own POST endpoint; a layout check does not protect it.
8. **Append-only schema history:** numbered migrations, each with a human-readable `.md` twin. Never edit an applied migration.
9. **Prefix every table with a 3-letter namespace** owned by one feature. Prefixes are permanent; retired ones are never reused.
10. **Reuse first for UI:** a registry of components, a template for new ones, theme tokens not literal colours.
11. **Plan, then wait for approval** before any multi-file change.
12. **Type errors are usually right.** Fix the call site; never silence with `Partial<>`, `?? ""`, `as`, or a newly-optional field.
13. **Never touch production data** from a script, gate or test. Gates work on copies and refuse unsafe paths.
14. **Report honestly:** list files changed, what was not verified, and what you are unsure about. "I wrote it" is not "it works".
15. **Don't gold-plate a one-off.** Write the simple version and say so in one line.
16. **Document the why.** Comments and docs record the reason and the incident, not what the code obviously does.

---

## 2. Stack and versions

Pin exactly the two that break on drift; caret the rest.

| Concern | Choice | Version used in MyHomeBase |
|---|---|---|
| Framework | Next.js App Router | `^16` |
| UI | React | `19.2.4` (exact) |
| Language | TypeScript, `strict: true` | `^5` |
| Styling | Tailwind CSS | `^4` with `@tailwindcss/postcss` |
| Database | SQLite via `better-sqlite3` (no ORM) | `12.9.0` (exact) |
| Validation | zod | `^4` |
| Unit tests | Vitest | `^5` |
| E2E | Playwright | `^1.62` |
| Lint | ESLint 9 flat config + `eslint-config-next` | `^9` |
| Script runner | tsx | `^4` |

Free: all of the above (open source). Add nothing paid or metered without asking.

---

## 3. Phase 1 — Repo skeleton  *(CHECKPOINT after)*

```
{{APP_NAME}}/
  CLAUDE.md                     # router + always-on rules (< 150 lines)
  docs/
    ARCHITECTURE.md             # section 1 above, plus layout and adapters
    coding-guide.md             # table prefixes, migrations, errors, naming
    components.md               # reusable-UI registry (start empty)
    design.md                   # theme tokens, breakpoint rules (if UI)
    lessons_learned.md          # traps, newest first
    CLI_registry.md             # commands that exist (if CLI)
    CHANGE_HISTORY.md           # newest first, [Added]/[Changed]/[Fixed]
  .claude/
    commands/verify.md          # the full gate, in order
    skills/release/SKILL.md     # log -> verify -> docs -> commit (only when asked)
  .github/workflows/ci.yml      # runs `npm run verify`
  .env.example                  # every variable, commented, no real secrets
  .gitignore                    # .next, node_modules, .verify, e2e/.auth, test-results, playwright-report, data/*.db*, .env*
  migrations/                   # NNNN_name.sql + NNNN_name.md
  scripts/
    check-lib-boundary.mjs
    migrate.ts
    verify-db.ts
    migration-dry-run.ts
    prepare-smoke-db.ts
    verify-preflight.mjs
  e2e/
    auth.setup.ts
    smoke.spec.ts
    global-teardown.ts
  src/
    lib/
      shared/                   # pure helpers: date, money, csv, result types
      <domain>/                 # types, schema, ports, <domain>, repository, fakes, index, *.test.ts
      wiring.ts                 # composition root
    app/
      (protected)/require-access.ts
      layout.tsx
    cli/{index.ts,parse-flags.ts}
    components/_component-template.tsx
  eslint.config.mjs
  vitest.config.ts
  playwright.config.ts
  next.config.ts
  tsconfig.json
  package.json
```

Steps:
1. `git init`; create the Next app with TypeScript, Tailwind, ESLint, App Router, `src/` dir, alias `@/*`.
2. Install: `better-sqlite3 zod` and dev `vitest @playwright/test tsx @types/better-sqlite3`.
3. Create the folders and empty docs above.
4. Write `.gitignore` entries listed (`.verify/` and `e2e/.auth/` are essential).

---

## 4. Phase 2 — Config files

### 4.1 `package.json` scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "npm run clean:next && next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "check:lib-boundary": "node scripts/check-lib-boundary.mjs",
    "clean:next": "node -e \"require('node:fs').rmSync('.next', { recursive: true, force: true })\"",
    "db:migrate": "tsx --env-file-if-exists=.env scripts/migrate.ts",
    "db:migrate:dry-run": "tsx --env-file-if-exists=.env scripts/migration-dry-run.ts",
    "verify:preflight": "node scripts/verify-preflight.mjs",
    "verify:prepare-db": "tsx --env-file-if-exists=.env scripts/prepare-smoke-db.ts",
    "verify": "npm run clean:next && npm run typecheck && npm run lint && npm run check:lib-boundary && npm test && npm run db:migrate:dry-run && npm run verify:preflight && npm run verify:prepare-db && npm run test:e2e",
    "cli": "tsx --env-file-if-exists=.env src/cli/index.ts"
  }
}
```

Note the order: **cheapest gate first**, browser last. `clean:next` runs first because `tsc` also typechecks
stale `.next/dev/types/**` left by deleted routes. (MyHomeBase: `package.json`, `.claude/commands/verify.md`.)

### 4.2 `tsconfig.json`

Next's default plus `"strict": true`, `"paths": {"@/*": ["./src/*"]}`, and `include` covering
`**/*.ts`, `**/*.tsx`, `.next/types/**/*.ts`, `.next/dev/types/**/*.ts`. Typechecking `scripts/` and `e2e/` too is deliberate.

### 4.3 `eslint.config.mjs`

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**", "out/**", "build/**", "next-env.d.ts",
    "playwright-report/**", "test-results/**", ".verify/**",
  ]),
  {
    // ARCHITECTURE.md hard rule: src/lib/ is framework-free.
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: ["react", "react/*", "next", "next/*"] }],
    },
  },
]);
```

Lesson: ignore generated output (deploy bundles, Playwright's trace viewer) or lint drowns real findings in thousands of reports.

### 4.4 `vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    // Playwright specs need a browser + server; Vitest must never collect them.
    exclude: ["e2e/**", "node_modules/**", ".verify/**"],
    passWithNoTests: true,
  },
});
```

### 4.5 `next.config.ts`

Start minimal. Add `serverExternalPackages: ["better-sqlite3"]` (native addon must stay a real `require`).
If you deploy as a standalone bundle also set `output: "standalone"` and exclude `data/**`, `.env*` via
`outputFileTracingExcludes`, **and** delete them from the assembled output in the publish script
(MyHomeBase found the exclude setting alone did not work). Raise `experimental.serverActions.bodySizeLimit`
only when an upload feature needs it, and document why next to the number.

### 4.6 `.env.example`

List every variable with a comment saying what it does and whether it is optional. Always include `{{DB_ENV}}`.
Never commit real values.

---

## 5. Phase 3 — Guardrail scripts  *(CHECKPOINT after)*

Write these exactly; they are the enforcement layer.

### 5.1 `scripts/check-lib-boundary.mjs`

```js
// Enforces ARCHITECTURE.md's one hard rule: nothing under src/lib/ imports react or next.
// A regex script rather than `! grep`: cmd.exe rejects a leading `!`, and grep patterns
// that assume single quotes miss double-quoted imports.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const LIB = path.join(process.cwd(), "src", "lib");
// static import, export-from, dynamic import(), require(); either quote style.
// Exactly `react`/`next` or a subpath — `react-is` and `nextdoor` must not match.
const FORBIDDEN = /(?:from|import|require)\s*\(?\s*["'](react|next)(\/[^"']*)?["']/g;

function collect(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...collect(p));
    else if (/\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

const violations = [];
for (const file of collect(LIB)) {
  readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
    FORBIDDEN.lastIndex = 0;
    if (FORBIDDEN.test(line)) {
      violations.push(`${path.relative(process.cwd(), file).replace(/\\/g, "/")}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (violations.length) {
  console.error("src/lib must not import react or next:\n" + violations.join("\n"));
  process.exit(1);
}
console.log("Library boundary clean.");
```

### 5.2 `scripts/migrate.ts`

Behaviour to implement (MyHomeBase: `scripts/migrate.ts`):
1. DB path = `process.env.{{DB_ENV}}` ?? `<cwd>/data/{{APP_NAME}}.db`; create the directory.
2. **Back up** an existing DB to `<db>.bak-<ISO-timestamp>` before touching it.
3. Open with `better-sqlite3`, `journal_mode = WAL`.
4. Create `sys_schema_migrations (id, filename UNIQUE, applied_at)` if missing.
5. List `migrations/*.sql`, sort by name, filter out applied.
6. For each pending file: in **one transaction**, `exec(sql)` then insert the filename. Print `Applying <file>...`.
7. Print "No pending migrations." or the applied count.

Do **not** copy MyHomeBase's `LEGACY_TABLE_RENAMES` block. It exists only because the project renamed prefixes mid-life.
Get prefixes right the first time.

### 5.3 `scripts/verify-db.ts` — the production-data guard

Export:
- `VERIFY_DIRECTORY = path.join(process.cwd(), ".verify")` (gitignored).
- `SMOKE_TEST_USERNAME`/`SMOKE_TEST_PASSWORD`: hardcoded, non-secret; the account exists only in a throwaway copy.
- `resolveSourceDatabasePath()`: **throws** if `{{DB_ENV}}` is unset (no silent fallback), throws if the resolved path starts with `<cwd>/data`, throws if the file does not exist.
- `copyDatabaseForVerification(name)`: removes stale `name`, `name-wal`, `name-shm`, then copies the `.db` **and its `-wal`/`-shm` sidecars** (WAL commits live in the sidecar).
- `runMigrationsAgainst(copyPath)`: `spawnSync` the migrate script with `{{DB_ENV}}` pointed at the copy; return its exit code.

Why: a migration once ran against the fallback DB; a smoke test once wrote rows into real data.
For a brand-new app with no dev DB yet, allow `resolveSourceDatabasePath` to fall back to a freshly migrated empty DB
(create it in `.verify/`), but keep the throw for "path inside `data/`".

### 5.4 `scripts/migration-dry-run.ts`

Copy the dev DB (5.3), run pending migrations against the copy, exit non-zero on failure, always print
"The development database was not touched."

### 5.5 `scripts/prepare-smoke-db.ts`

Copy the dev DB to `.verify/smoke.db`, run migrations on it, and create the smoke user (from `verify-db.ts` constants)
through the **lib** use-case, not raw SQL. Skip user creation if `{{AUTH}}` is no.

### 5.6 `scripts/verify-preflight.mjs`

Refuse to start the browser gate if ports 3000 or 3100 are in use (TCP connect probe, 1.5 s timeout), with a message
telling the user to stop their dev server. Reason: `clean:next` deleted `.next` under a live dev server, which thrashed
and leaked ~1,600 orphaned worker processes.

---

## 6. Phase 4 — Playwright smoke gate

`playwright.config.ts` decisions (each is deliberate):

| Setting | Value | Reason |
|---|---|---|
| port | `3100`, not 3000 | the gate must boot a fresh server with a cleared `.next` |
| `workers: 1`, `fullyParallel: false` | | one dev server, one SQLite file |
| `retries: 0` | | a retry that passes hides intermittent breakage |
| `forbidOnly: true` | | |
| baseURL host | `localhost`, not `127.0.0.1` | Next blocks HMR for 127.0.0.1 and the page never hydrates |
| `timeout` > `navigationTimeout` | 150 s > 90 s | slow first compile must fail as navigation, not a mystery timeout |
| `webServer.env` | `{{DB_ENV}}` = `.verify/smoke.db` | never the real DB |
| `reuseExistingServer` | `false` | |
| projects | `setup` (auth) then `chromium` with `storageState` | log in once |

`e2e/auth.setup.ts`: go to `/login` with `waitUntil: "networkidle"` (an unhydrated controlled form loses typed text),
fill by exact label text, assert the values stuck (proves hydration), submit, wait for the URL to leave `/login`,
save `storageState` to `e2e/.auth/state.json`.

`e2e/smoke.spec.ts`: sweep every route a signed-in user can reach and, per route, **soft-assert** three things:
HTTP status < 400; no `console.error`/`pageerror` (with a small ignore-list); the Next dev error overlay is not shown
(match its heading text, not `nextjs-portal`, which exists on every dev page). Hardcode fixed routes; **discover**
feature routes from the navigation at runtime so a new feature is covered automatically.

---

## 7. Phase 5 — Reference domain: the pattern every feature copies  *(CHECKPOINT after)*

Build `{{FIRST_DOMAIN}}` end to end as the template. Layout in `src/lib/{{domain}}/`:

| File | Content |
|---|---|
| `types.ts` | domain types. Split `FooSummary` (list row) from `Foo` (full record) if rows are heavy |
| `schema.ts` | zod schemas, limits as named constants with a comment explaining each number |
| `ports.ts` | repository interface(s), each method documented |
| `{{domain}}.ts` | use-cases: functions taking `(deps, input)` and returning data. No hidden I/O |
| `repository.ts` | SQLite implementation; **only** place that touches the DB; returns domain types, never raw rows |
| `fakes.ts` | hand-written in-memory repository; **not** re-exported from `index.ts` |
| `index.ts` | the public surface. Other code imports `@/lib/{{domain}}`, never internals |
| `{{domain}}.test.ts` | use-case tests with the fake: success **and** failure paths |
| `repository.test.ts` | the same contract against real in-memory SQLite built from the migration |

Reference implementation to read before writing: `MyHomeBase: src/lib/todo/` (small, complete) and `src/lib/household/`.

Then add the adapters:
1. **Migration** `migrations/0002_create_{{prefix}}_<table>.sql` + `.md` (see section 9).
2. **Wiring:** add the repository to `deps` in `src/lib/wiring.ts`.
3. **Server action** `src/app/.../{{domain}}-actions.ts`: first line is the guard, then zod-parse, then call lib, return `{ ok, error? }`.
4. **View** under `src/app/`: server component fetches via lib, passes plain data to a client view.
5. **CLI** `src/cli/{{domain}}.ts` (if `{{CLI_NEEDED}}`): thin adapter; usage in the doc comment; register in `src/cli/index.ts` and `docs/CLI_registry.md`.

Rules for the tests:
- Fakes reproduce the behaviours the use-case depends on (cascade on delete, "unknown id = zero changes", case-insensitive uniqueness).
- **Where a fake and the real repository can disagree about shape, test the shape against real SQLite.** A fake storing whole objects cannot catch a list row missing a field.

---

## 8. Auth and access guards (if `{{AUTH}}`)

`src/app/(protected)/require-access.ts` exports three guards; every exported server action calls one **on its first line**:

```ts
export async function requireUser(): Promise<User> { /* read session cookie via lib -> user or throw "You must be signed in." */ }
export async function requireAdmin(): Promise<User> { /* requireUser + isAdmin or throw "Administrators only." */ }
export async function requireModuleAccess(slug: string): Promise<User> {
  /* requireUser; look up the {{FEATURE_UNIT}} by EXACT slug (WHERE slug = ?); unknown slug is a programmer error;
     admins pass by role; otherwise require a grant row */
}
```

Rules: match the **full slug exactly**, never a prefix, never a route path. The decision logic (`isAdmin`, `userHasModuleAccess`)
is in `lib`; the guard is only the adapter that reads the cookie. Next's default middleware runtime is Edge and cannot load
native addons like `better-sqlite3`, so keep middleware to routing; do auth decisions in server code.
Hiding a nav item is **not** access control. Add a test or a grep check that every exported action file imports a guard.

---

## 9. Database conventions (`docs/coding-guide.md`)

- **Table names:** `<3 letters>_<plural_noun>`, lowercase. `sys_` is reserved for the platform (users, sessions, settings, migrations).
  A prefix names the feature's **domain**, not its first table (a `pho_` gallery, not `alb_`; a `tol_` tools area, not `sql_`),
  so the second table still fits. Record every prefix in a table in `docs/coding-guide.md`; record retired ones as retired.
- **Migrations:** `NNNN_verb_noun.sql` zero-padded, strictly increasing. Each has `NNNN_verb_noun.md` with: date, type
  (new table / copy-rename-drop), what it does, a columns table, seed data, **rollback**.
- **Standard columns:** `id INTEGER PRIMARY KEY AUTOINCREMENT`, `created_at TEXT NOT NULL DEFAULT (datetime('now'))`,
  `updated_at` with an `AFTER UPDATE` trigger when rows are editable. Boolean = `INTEGER CHECK (x IN (0,1))`.
- **Changing a table:** copy-rename-drop pattern, and rehearse it with `npm run db:migrate:dry-run` first.
- **Never edit an applied migration.** Add a new one.
- **Never put business logic in SQL triggers** beyond timestamps.
- List queries select named columns; never `SELECT *` into a summary type. Heavy blobs/long text stay out of list payloads.

---

## 10. UI conventions (if there is a UI)

- **`docs/components.md`** is a registry: name, props, where it renders. Check it before building any UI element.
  Copy `src/components/_component-template.tsx` for new ones: props in, events out, no fetching, no business logic,
  `className` passthrough merged last, variants as a small named union.
- **If it looks reusable and isn't registered, ask** "should this be reusable? give it a name", then create and register it.
- **Colours and fonts are theme tokens** defined in `docs/design.md`, never literals.
- **One breakpoint** (1024 px). Restyle with `max-lg:` variants first so desktop classes provably don't regress. Use a
  `useViewport()` hook only when the narrow screen needs a genuinely different component. Say how every new screen behaves narrow.
- **Navigation is a closed system:** one shell, a registry that declares sections; a new feature adds an entry, never its own bar.
  Floating UI (clock, calculator, player) registers in one list and renders in one layer; never add a new `fixed bottom-0`.
- **Prove where a component renders before restyling it:** `grep -rn "<ComponentName" src/`. An import or a doc mention is not
  a call site. Shared components get migrated away from and stale references linger.
- **Icons that mark a place** go through a registered slot id (ids are permanent once users upload overrides). Propose slot ids
  and wait for confirmation. Row actions and state glyphs stay plain.

---

## 11. CLAUDE.md to generate (final text)

Write this to `CLAUDE.md`, replacing placeholders. Keep it under 150 lines; deeper detail goes in `docs/`.

````markdown
# Project conventions

Strict layering: **all logic lives in `src/lib/`; the presentation layers
(`src/app/`, `src/cli/`, `src/components/`) only present.**

## Read the right doc before writing code
- Before scaffolding, or adding/changing any logic: read `docs/ARCHITECTURE.md` and follow it.
- Before building any UI element: read `docs/components.md` and reuse what fits.
- Before styling any UI: read `docs/design.md` — colours/fonts are theme tokens.
- Before adding a table, column or migration: read `docs/coding-guide.md`.
- Before adding a {{FEATURE_UNIT}}: read `docs/modules.md` (registry + recipe).
- Creating a reusable component: start from `src/components/_component-template.tsx`.

## Plan before building — wait for approval
Before writing code for a new feature or multi-file change, read `docs/ARCHITECTURE.md` and the
closest existing {{FEATURE_UNIT}}, then present: (1) files to create/modify by path, (2) migration
and registry changes, (3) third-party services and whether each is **free**, (4) open questions.
Then stop and wait. Exempt: single-file fixes, typos, renames, mechanical shell commands.

## Always-on rules
- Business logic goes in `src/lib/` as functions that take data and return data — never in a
  `.tsx`, a route, or a CLI command.
- Nothing under `src/lib/` may import from `react` or `next` (lint + `npm run check:lib-boundary`).
- Every use-case is callable identically from the web app and the CLI. Validate boundary input
  with the domain's zod schema.
- Every exported server action authorises on its first line (`requireUser` / `requireAdmin` /
  `requireModuleAccess(<FULL_SLUG>)`). Match the slug exactly.
- New lib logic ships with a colocated Vitest test (success + failure paths).
- A type refusing your argument is usually right. Fix the call site; do not add `Partial<>`,
  `?? ""`, `as`, or optional fields to make the error go away. If unsure, ask.
- Never fill an editor from a list row; fetch the full record.
- UI is reuse-first. Every UI change must work on a phone and a desktop (one boundary, 1024px).
- Don't gold-plate a one-off: write the simple version and say so in one line.

## Safety
- Nothing may touch {{PROD_DATA}}. Scripts use `{{DB_ENV}}`; gates run on copies in `.verify/`
  and abort if it is unset or points inside `data/`.

## Verification
- `npm run verify` is the gate (typecheck, lint, lib-boundary, unit, migration dry-run, browser smoke).
  CI runs the same command on every push. When a change is finished, Claude asks once: "Do you want me
  to start running the gates?" (naming which ones, via AskUserQuestion Yes/No when available). On yes it
  runs the relevant gates using the token-efficient method below; on no it runs nothing and says which
  gates would have covered the change. It never runs a gate unprompted or asks mid-task, and does not
  re-ask if the user already said "run the gates" or `/verify`.
- **Token-efficient gate running:** run cheap gates first and stop at the first failure; show only the
  failing lines (`2>&1 | tail -40`, or the reporter's `--reporter=dot`); never paste full green output;
  run only the affected test file while iterating (`npx vitest run src/lib/<domain>`), then the full
  suite once at the end; run the browser smoke only when routes, UI, or the schema changed, not for
  a lib-only edit. Report one line per gate: pass/fail and the failing file:line.
- A UI change that "isn't taking effect" is a stale `.next` cache until proven otherwise:
  `npm run clean:next`, hard-reload.
- Before restyling a component, `grep -rn "<ComponentName" src/` and name the screens it renders on.
- Uncommitted work is unverified work, including your own from an earlier session.

## Report done honestly
Close every change by naming: (1) every file created/modified, (2) what you did **not** verify,
(3) anything you are unsure landed. Never call something working because you wrote it.

## Stack
Next.js App Router + TypeScript (strict). Path alias `@/* -> src/*`. SQLite via better-sqlite3.
````

**A deliberate departure from MyHomeBase:** its CLAUDE.md forbids Claude from running any gate unless asked.
That rule was introduced to reduce token usage (verbose gate output flooding the context), not because gates are unsafe.
For a new project, *do* let Claude run the gates, and control token cost with the practices in section 12a instead of a ban.
Manual-only gates are the biggest weakness found in the original.

---

## 12. CI and hooks

`.github/workflows/ci.yml` (adapt for `{{CI}}`):

```yaml
name: ci
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run check:lib-boundary
      - run: npm test
      - run: npm run build
      # Browser smoke needs a seeded DB; set {{DB_ENV}} to a migrated fixture outside data/.
      - run: npm run db:migrate:dry-run && npm run verify:prepare-db && npm run test:e2e
```

Optional pre-commit hook (husky or a plain `.git/hooks/pre-commit`): `npm run typecheck && npm run check:lib-boundary`
(seconds, not minutes). Keep heavy gates for CI.

---

## 12a. Running the gates cheaply (Claude should run them)

Gates are how Claude knows a change is correct, so Claude runs them once the user approves ("Do you want me to start running the gates?"). The cost is controlled by *what is shown*, not by skipping.

| Situation | Run | Why |
|---|---|---|
| Edited one lib file | `npx vitest run src/lib/<domain>` then `npm run typecheck` | seconds; covers the change |
| Edited anything in `src/lib/` | add `npm run check:lib-boundary` | a one-second regex scan |
| Changed UI, routes, or navigation | add `npm run lint` and the browser smoke | smoke is the only gate that renders pages |
| Changed `migrations/` | `npm run db:migrate:dry-run` | rehearses on a copy |
| About to report done / commit | `npm run verify` once | the full chain, cheapest first |

Output hygiene (put these in `.claude/commands/verify.md`):
- Pipe through `tail -40` (or `| grep -E "error|FAIL|✗" | head -40`) so only failures reach the context.
- Prefer a terse reporter (`vitest run --reporter=dot`); keep Playwright's `list` reporter off in agent runs if output is large.
- On a red gate, fix and re-run **from that stage**, not from the start.
- Never re-run a green gate "to be sure" if nothing it covers changed.
- Summarise as `typecheck ✓ · lint ✓ · boundary ✓ · unit ✓ (214) · dry-run ✓ · smoke ✗ /journal 500`.
- Still never point any gate at real data: the `.verify/` copy rules in section 5 apply to every run.

---

## 13. Claude Code assets

- **`.claude/commands/verify.md`:** the gate stages in order, ground rules (never against real DB; loop until green;
  report rather than silently fix someone else's uncommitted work), the `.next` clean-first explanation, and the
  token-efficient output rules from section 12a.
- **`.claude/skills/release/SKILL.md`:** (1) get date, read `git diff`, prepend a tagged entry to `docs/CHANGE_HISTORY.md`;
  (2) verify; (3) sync docs; (4) commit. Triggers **only when explicitly asked**.
- **Tag every change** `[Added]`, `[Changed]`, `[Fixed]` so counts can be derived.
- **`docs/lessons_learned.md`:** a log of mistakes whose *mechanism* generalises, newest first. Format: date, what broke,
  why it was worse than it looked, evidence, the fix, **numbered rules**, and a testing note. Not a changelog.
  Seed it with the two standing lessons: *a type refusing your argument is usually right*, and
  *when the reporter says which side of a boundary is correct, don't debug the other side*.

---

## 14. Workflow and process

- **Branching:** trunk on `main` is fine solo. For a team add short-lived branches and PRs, with CI as the required check.
- **Commits:** imperative, feature-led subject (`Journal: Merge bulk action on every entry grid`). Prefer Conventional Commits
  (`feat:`, `fix:`) in a new project; MyHomeBase's free-form style makes history harder to filter. One concern per commit.
- **Release checkpoint** is a ritual, not an accident: log, verify, docs, commit, push.
- **Docs are updated in the same commit as the code** they describe.
- **Registries stay small enough to read.** Prune; don't let a changelog or registry reach tens of thousands of words in the
  repo root (MyHomeBase's reached ~300k words across root markdown). Keep them under `docs/`, split by feature.
- **Delete dead code.** Git is the revert. MyHomeBase keeps `ModuleRail` and `TreeNav` with no call site and has to warn
  the agent about them in CLAUDE.md.
- **No binaries or build artifacts in git** (a deploy zip was committed then removed). Prefer cross-platform Node scripts to
  `.bat` files.
- **Keep personal data out of git** with `.gitignore` plus a comment explaining why.

---

## 15. Build order  *(each ends in a CHECKPOINT)*

1. **Phase 0:** collect decisions (section 0).
2. **Phase 1:** repo skeleton, dependencies, `.gitignore` (section 3).
3. **Phase 2:** config files (section 4).
4. **Phase 3:** guardrail scripts (section 5). *Report: run `npm run check:lib-boundary` and `npm run typecheck` to confirm they work on an empty app.*
5. **Phase 4:** Playwright config + auth setup + smoke sweep (section 6).
6. **Phase 5:** reference domain end to end with tests (section 7).
7. **Phase 6:** docs (`ARCHITECTURE.md` from section 1; `coding-guide.md` from section 9; `components.md`; `design.md`), `CLAUDE.md` (section 11), Claude assets (section 13).
8. **Phase 7:** CI (section 12). Run `npm run verify` once locally and fix until green.
9. **Phase 8:** final report listing every file, what was verified (with the command output) and what was not.

---

## 16. Definition of done for any later change

- [ ] Logic is in `src/lib/`; presentation only presents.
- [ ] Zod schema validates boundary input; server action authorises on line one.
- [ ] Colocated test with success **and** failure paths; real-SQLite test if shape matters.
- [ ] Numbered migration + `.md` twin if the schema changed; prefix recorded.
- [ ] Reused or registered a component; theme tokens only; phone and desktop behaviour stated.
- [ ] CLI command added if the use-case should be scriptable; `CLI_registry.md` updated.
- [ ] `CHANGE_HISTORY.md` entry with a tag; docs updated in the same commit.
- [ ] `npm run verify` green (CI too).
- [ ] Report names files changed, what was not verified, and anything uncertain.

---

## 17. Pitfalls to avoid (from MyHomeBase's history)

| Pitfall | Rule |
|---|---|
| Stale `.next` makes a UI change "not take effect" or breaks `tsc`/build | `npm run clean:next` first; `verify` and `build` do it automatically |
| Deleting `.next` under a live dev server leaks workers | `verify:preflight` refuses to start while ports 3000/3100 are busy |
| Script falls back silently to a repo `data/` DB | no fallback in gates; abort if env unset or path inside `data/` |
| Smoke test writes into real data | it runs against `.verify/smoke.db`, a copy |
| `127.0.0.1` breaks hydration in dev | use `localhost` |
| Editor filled from a list row, then saved blank over real data | fetch the full record; type the form builder to take the full type |
| Hand-written fake can't see shape bugs | add a real-SQLite test for the shape |
| Debugging the layer that wasn't broken | trust the reporter's boundary; change layers, not inputs |
| `Partial<>` + `?? ""` to silence a type error | fix the call site |
| Prefix named after the first table | name it for the domain; prefixes are permanent |
| Module prefix `startsWith` match for access | exact slug equality only |
| A dependency with a native addon breaks the bundle | list it in `serverExternalPackages`; laziness is not bundling |
| Server-action body limit hit by uploads | raise `bodySizeLimit` with a comment; send big files as `FormData`, not JSON |
| Banning gates to save tokens leaves every change unverified | let Claude run them; cut tokens by trimming output and running only affected gates (12a) |
| Docs drift (`CLI_registry.md` count vs code) | derive counts from code where possible; prune registries |
