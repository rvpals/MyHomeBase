# 0061 — Scheduled runs, and the Stocks auto-refresh switch

Adds `sys_scheduled_runs` (last-run bookkeeping for background jobs) and seeds two
`sys_module_settings` rows on the Stocks & ETFs module: `auto_refresh_enabled`
(default `false`) and `auto_refresh_interval` (default `daily`).

## Why

Refresh All is a button. Everything it does — price every position, look up any new
sector, file today's snapshot — is worth having happen without anyone pressing it,
and the value history depends on it: a day nobody pressed the button is a hole in the
chart that cannot be backfilled, because the provider serves today's price and not
last Tuesday's.

The app already runs background work this way. `src/instrumentation.ts` arms the
Expense CSV auto-import and the auth-event prune on a 60-second heartbeat that
re-reads its settings every tick. This is a third job in that mould, so the settings
live where the expense importer's live (module settings) and the scheduling decision
is a pure function (`shouldRunNow`) for the same reason.

## Why the last-run timestamp is persisted, when the other two jobs keep it in memory

This is the one place this job deliberately diverges from the pattern it copies.

The expense importer holds `__expenseAutoImportLastRunMs` on `globalThis`. At a
60-minute interval that is harmless: a restart re-runs the import a little early and
nothing downstream cares.

At a **daily** interval — this job's default — it stops being harmless. `start.sh`
cycles the process on every deploy, and its every-minute keepalive task restarts it
after any crash. In-memory state therefore turns "once a day" into "once a day, plus
once per deploy, plus once per crash", which is the one reading of the setting nobody
asked for.

Persisting also makes a missed window self-correcting in the right direction: the NAS
can be asleep, mid-deploy, or mid-migration at the appointed hour, and the next tick
still observes that the interval has elapsed and runs. An in-memory stamp cannot tell
"we already did this today" from "this process started ten seconds ago".

## Why `job_key` is the primary key

Same reasoning as `stk_ticker_favorites.ticker` (0058). A job has no identity beyond
its name, there can only be one row per job, and nothing will reference it by a
surrogate key — so keying on the name makes a run-stamp one upsert against a known
key instead of a select-then-write, and removes the "same job twice" bug class
outright rather than guarding it with a separate unique index.

The table is generic (`job_key`, not `stock_auto_refresh_last_run`) because the two
jobs already in `instrumentation.ts` have the same in-memory weakness and can move
here without a migration.

## `last_run_at` is when the run STARTED

Stamped before the work, not after. That is what stops a slow pass from overlapping
the next tick — a full refresh walks every position against a rate-limited upstream
and can outlive a 60-second heartbeat. Same ordering, and the same reason, as the
expense importer's in-memory stamp.

`last_status` is nullable as a consequence: a row exists from the moment a run
begins, so a process killed mid-pass leaves the outcome genuinely unknown rather
than claiming success. `last_detail` is a rendered string ("38 priced, 1 failed")
rather than a JSON blob — nothing queries it, and giving it a schema would only mean
having a schema to migrate later.

## Why the switch is seeded OFF

The opposite default from the expense importer's switch, on purpose.

That one defaults ON, and its own comment says why: it was retrofitted over installs
that were *already* auto-importing, so defaulting off would have silently stopped
working setups. There is no existing behaviour to preserve here — this job has never
run — so the default is the safe one.

It also makes outbound calls to a free, unauthenticated Yahoo endpoint. A deploy that
quietly starts hitting a shared upstream on a timer is a bad surprise, and the cost
lands somewhere other than this machine.

## Why the interval is a token, not a number of minutes

`'hourly' | 'half-daily' | 'daily'`, where the expense importer stores free-text
minutes.

The UI offers exactly three choices, so the storage should not be able to represent
"every 7 minutes". If it could, every reader would have to decide whether that is
legal, and the answer would end up living in three places. A closed set in the column
means the zod enum in `src/lib/scheduled-refresh/schema.ts` is the only thing that
has an opinion.

`daily` is the default because a portfolio's numbers move on a daily cadence, and
because `src/lib/ticker-profiles/ticker-profiles.ts` already records what happens
when this provider is pushed: "firing forty concurrent requests at Yahoo is how a
free endpoint starts answering 429". Hourly is offered because it was asked for, not
because it is advisable.

## Seeds are `INSERT OR IGNORE`

`sys_module_settings` has `UNIQUE (module_id, setting_key)`, so a plain `INSERT`
would throw on an install that already has these keys. Both seeds are also
`SELECT ... FROM sys_modules WHERE slug = 'stock-etfs'`, which inserts nothing at all
on an install where that module was removed (0026 shows a module being dropped) —
the reader treats absent rows as "off", so a missing seed degrades to disabled rather
than to an error.
