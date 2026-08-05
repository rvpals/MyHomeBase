---
description: Run every quality gate in order — typecheck, lint, library boundary, unit tests, a migration dry-run against a copy of the dev DB, and a browser smoke test over every route. Fix failures and re-run until green.
---

# Verify

The full quality gate for this repo. Run the stages **in order** — each is cheaper than
the one after it, so a failure should be found as early as possible.

`npm run verify` chains all of it. Run the stages individually when you need to see
where something breaks, or when iterating on one failure.

This is the verification counterpart to `/release_myhomebase` (deploy) and overlaps
`/build_project` (which also runs typecheck / lint / test, plus a production build and
the changelog ritual). Use `/verify` while working; use `/build_project` at a release
checkpoint.

## Ground rules

- **Never run a gate against the real database.** Stages 3 and 4 copy the development
  database into `.verify/` and work on the copy. The copy step refuses to run if
  `MYHOMEBASE_DB` is unset or resolves inside the repo's `data/` folder — that fallback
  is what once let a migration hit the wrong database.
- **The deployed instance at `C:\webapp\MHB` is a separate tree.** Nothing here touches
  it, and a green `/verify` says nothing about what is deployed.
- **Loop until green.** After fixing anything, re-run from the failing stage. Do not
  report completion while a gate is red.
- **Report, don't silently fix, someone else's work in progress.** If a failure is
  inside uncommitted work you didn't write, say what broke and where, and ask before
  changing it.

## 1. Typecheck

```
npm run typecheck
```

`tsc --noEmit` over the whole repo, including `scripts/` and `e2e/`.

## 2. Lint and the library boundary

```
npm run lint
npm run check:lib-boundary
```

The boundary check enforces ARCHITECTURE.md's one hard rule: nothing under `src/lib/`
may import `react`, `next`, or `next/*`. It prints `file:line` for every violation.

## 3. Migration dry-run against a copy of the dev database

```
npm run db:migrate:dry-run
```

Copies the development database (`.db` plus its `-wal`/`-shm` sidecars, or recent
commits would be lost) to `.verify/migration-dry-run.db`, then runs the real
`scripts/migrate.ts` against the copy. It echoes both the source and the copy path —
**read them** and confirm the source is the database you expected.

A failure here means a pending migration is broken. The development database is
untouched either way.

## 4. Browser smoke test over every route

```
npm run verify:preflight
npm run verify:prepare-db
npm run clean:next
npm run test:e2e
```

- `verify:preflight` aborts if ports 3000 or 3100 are already listening. **Do not skip
  it.** Clearing `.next` while another dev server is serving out of it corrupts that
  server; doing so once left ~1600 orphaned Turbopack workers running and saturated the
  machine badly enough that the gate's own server could not start. Port 5200 is the
  deployed instance and is irrelevant here.
- `verify:prepare-db` builds `.verify/smoke.db`: a migrated copy of the dev database
  plus an admin account (`verify-smoke-user`) with access to every module. The smoke
  test writes rows, which is why it gets a copy.
- `clean:next` deletes `.next`. This is not optional — a stale dev cache has been
  mistaken for a real bug more than once, and clearing it here is what makes the smoke
  result trustworthy.
- `test:e2e` boots a **fresh** dev server on port **3100** (not 3000, so it can't
  attach to a dev server you already have running) pointed at the copy, signs in once,
  and sweeps:
  - `/` and `/account`
  - all ten `/admin/*` pages
  - every module dashboard and every section, **discovered from the navigation at
    runtime** rather than hardcoded — 16 routes as of now, and the run prints the list
    so a crawl that silently finds nothing can't pass as a full sweep
  - the signed-out `/login` and `/login/register` pages, plus a real create-account
    submission

  Each page must return under 400, show no Next.js error overlay, and log no console
  errors. Assertions are soft, so one run reports every broken route rather than just
  the first. A global teardown reaps any dev worker still running afterwards.

Two things the harness has to do that are easy to get wrong if it's ever rewritten:
the base URL must be **`localhost`**, not `127.0.0.1` (Next treats the latter as
cross-origin and blocks its own HMR endpoint, which breaks hydration — and an
unhydrated form silently does a native GET instead of running its submit handler); and
the overlay check matches the overlay's **heading text**, because the `nextjs-portal`
element hosts the dev-tools indicator and is present on every dev page.

If it fails: `npx playwright show-report` for the HTML report, with a trace and
screenshot retained for each failure.

## 5. Report

State which stages passed, and for anything red give the route or `file:line`, the
actual error, and what you changed. If you stopped short of fixing something, say so
explicitly.
