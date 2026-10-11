# Migration 0136: "Hello, world!" job settings

**Date:** 2026-10-10
**Type:** four seed rows in `sys_app_settings`, no new tables, no changes to existing objects

## What this does

Seeds the four settings behind the new **Hello, world!** background job, configured on
**Administration → Background Tasks → Configuration**: what the job says, and how often
it says it.

| Key | Seeded value | Meaning |
|---|---|---|
| `hello_world_enabled` | `false` | Whether the scheduled pass runs. A manual run ignores it |
| `hello_world_message` | `Hello, world!` | Filed as the title of each run's queue message |
| `hello_world_interval_count` | `1` | The number half of the cadence |
| `hello_world_interval_unit` | `minute` | `second`, `minute`, `hour`, `day` or `week` |

## What the job does

Each run files one message into the application-wide message queue
(`sys_messages`, migrations/0109), with the configured message as its title and
`Hello, world!` as its `source`. That is the point: the unread badge sits in **every**
shell's header, so a working scheduler is visible from wherever you happen to be
standing — no log to tail, no admin screen to sit on.

It is the cheapest possible answer to *"is the scheduler actually alive on this
install?"*. Every other job is silent when it has nothing to do, which makes a stopped
scheduler look exactly like an idle one — the failure mode that let the instrumentation
hook sit broken for six weeks (see the comment at the top of `src/instrumentation.ts`).

The message is filed through `createMessage`, so it is validated by the queue module's
own schema and lands in the same shape the Investments monitor and the `messages` CLI
command produce. That function's doc comment already anticipated "a future scheduled
job"; this is it.

The run stamp is stored in UTC like every other job's, and the Background Tasks screen
renders it through `UtcTime`, so each reader sees it on their own browser clock. The job
never formats a local time itself — the server's zone is the NAS's, not the reader's.

## Queue volume — read this before arming it

**Nothing prunes the message queue on a timer.** The only cleanup is the manual purge on
Administration → Message Queue. So the cadence is also a decision about how fast the
queue fills:

| Cadence | Messages per day |
|---|---|
| every 1 minute | ~1,440 |
| every 15 minutes | ~96 |
| every hour | 24 |
| every day | 1 |

The admin card states this figure next to the interval, recomputed as you type, so the
cost is visible before the switch is turned on. The job is seeded **off**, so no install
starts filling its queue by upgrading.

A minute-by-minute cadence is a reasonable way to *watch* the scheduler for an hour and a
poor way to leave it running for a month. Purge by age afterwards — the messages all
carry `source = 'Hello, world!'`, so they are easy to pick out from real ones.

## Why a count plus a unit, and not a number of minutes

Because that is what the reader types: `1` and `minute`. Storing the resolved minutes
would mean the screen either shows back a figure nobody entered ("every 10080 minutes")
or reverse-engineers a unit from it, which is ambiguous — 60 minutes is equally "1 hour"
and "60 minutes". Keeping the two halves separate means the screen shows back exactly
what was chosen. `intervalToMinutes` in `src/lib/hello-world/settings.ts` is the single
place the pair becomes a duration.

## The sub-minute caveat

`second` is offered, and the scheduler is a fixed **60-second heartbeat**
(`src/instrumentation-node.ts`), so any cadence under a minute fires *once a minute* and
no faster. The stored value is left exactly as the reader entered it rather than being
clamped on save — the clamp lives in `shouldRunNow` and `nextRunDueAtMs`, and the admin
card says so in words. Silently rewriting a saved setting would be the worse behaviour.

## Why app settings and not module settings

The job belongs to no module, so there is no module row to hang its settings off. Same
situation, and the same resolution, as the Data backup's keys in migrations/0134.
`sys_app_settings` (migrations/0002) is the app-wide key/value store and takes arbitrary
keys.

## Why this migration is optional, and why it exists anyway

`SqliteSettingsRepository.updateAll` **upserts**, so saving works against keys that have
never been stored. This one exists for the `description` column, which the upsert
deliberately leaves alone and which is the only record inside the database of what each
key means.

`ON CONFLICT(key) DO NOTHING` so re-running it cannot overwrite a configured message
with the default.

## Effect on an existing install

**Applying this migration changes no existing screen and starts no job.** The job seeds
switched off, so it appears under *Inactive Tasks* on Background Tasks until an admin
turns it on. `DEFAULT_MODULES` is unchanged — no new module, and no new table.

The job key `hello_world` is written to `sys_scheduled_runs.job_key` and
`sys_scheduled_run_history.job_key` once it first runs. Like every other job key it is
**permanent** — renaming it would orphan both rows.
