# Migration 0135: execution history for background jobs

**Date:** 2026-10-10
**Type:** one new table (`sys_scheduled_run_history`) + one index, no changes to existing objects

## What this does

Records **one row per pass** of every background job, so Administration → Background
Tasks can show each task's execution history: when it started, when it finished, how
long it took, and how it turned out.

| Object | Change |
|---|---|
| `sys_scheduled_run_history` | new table — `id` PK, `job_key`, `started_at`, nullable `finished_at`, nullable `status`, `detail` |
| `idx_scheduled_run_history_job` | new index on `(job_key, id DESC)` — serves both the dialog and the prune |

## Why a second table rather than extending 0061

`sys_scheduled_runs` is keyed on `job_key`, so it holds exactly one row per job and
`start()` **overwrites** it on every pass. That is the right shape for the question it
answers — *did this job run, and how did it go?* — and the wrong shape for *show me the
last N runs*. It also stores only a start time, so a duration could not be computed from
it at all.

Keeping them separate also keeps a hot path fast. 0061's row is read on every render of
the Background Tasks screen **and on every scheduling decision** — the runners parse
`last_run_at` to decide whether an interval has elapsed. Turning that single-row lookup
into "the newest of N" would put a sort on the 60-second heartbeat of five jobs to serve
a dialog that is usually closed.

## Where history is written

**Inside `SqliteScheduledRunRepository.start()` and `.finish()`** — not in the runners.
All five runners already call exactly those two methods, so every job gains history
without a single runner change, and no future job can be added that forgets to record
itself. `start()` inserts and prunes; `finish()` updates the newest open row.

## Retention

**50 runs per job**, pruned on every insert. Across five jobs that is ~250 rows, which is
negligible against a 105 MB database. The cost is one INSERT plus one small DELETE per
job tick — on a 60-second heartbeat, nothing.

## The nullable columns

`finished_at` and `status` are NULL together, and mean *the pass started but never
finished* — the process was killed mid-pass, or a deploy cycled the server while it was
working. Same reasoning as 0061's nullable `last_status`: an unknown outcome must read as
unknown rather than as success. This is the column that makes a mid-pass death **visible**
instead of invisible.

`job_key` is deliberately **not** a foreign key: 0061's row is an upsert target that may
not exist when the first history row is written, and a retired job's history should
survive rather than cascade away.

## Effect on an existing install

**Applying this migration changes no screen and starts nothing.** The table is created
empty and fills from the next run onward, so each job's history dialog reads "no runs
recorded yet" until its next pass. Nothing is backfilled — inventing one row from the
last-run table would be fabricating a finish time that was never recorded.
`DEFAULT_MODULES` is unchanged.
