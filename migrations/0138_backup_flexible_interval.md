# Migration 0138: the Data backup's cadence becomes a count plus a unit

**Date:** 2026-10-11
**Type:** two seed rows in `sys_app_settings` plus one `description` update, no new tables, no dropped columns, no dropped rows

## What this does

Replaces the Data backup's fixed interval enum with the same count-plus-unit cadence the
**Hello, world!** job already uses (migrations/0136), so a backup can run *every 6 hours*
or *every 3 days* instead of only hourly, daily, weekly or monthly.

| Key | Seeded value | Meaning |
|---|---|---|
| `backup_interval_count` | `1` | The number half of the cadence |
| `backup_interval_unit` | `day` | `second`, `minute`, `hour`, `day` or `week` |

| Key | What changed |
|---|---|
| `backup_interval` | **Superseded.** Value untouched, `description` rewritten to say so |
| `backup_start_time` | **Unchanged**, and still read — see below |

## Why `backup_start_time` survives

A fixed enum needed an anchor: *"every day"* had to mean *"every day at 02:00"* or it
meant *"24 hours after whenever the switch happened to be flipped"*. A flexible cadence
needs that anchor just as much, so it stays and still anchors the **first** run via
`firstRunAtOrAfter`. After the first run the cadence is measured from the last run, which
is what it always did.

This is the one place the backup's scheduling differs from Hello, world!'s, which has no
anchor at all and fires on the next heartbeat after it is armed.

## How an existing choice is carried across

The `UPDATE`-shaped `INSERT … SELECT` pair at the top of the `.sql` maps a stored
`backup_interval` onto the new pair before the plain defaults are seeded:

| Old `backup_interval` | New count | New unit |
|---|---|---|
| `hourly` | `1` | `hour` |
| `daily` | `1` | `day` |
| `weekly` | `1` | `week` |
| `monthly` | `30` | `day` |

`monthly` becomes 30 days because that is exactly what it already meant — the old
`INTERVAL_MINUTES` table in `src/lib/backup/settings.ts` defined monthly as `30 * 24 * 60`
and never tracked calendar month lengths. Nothing is lost in the translation.

Without this carry-across, an install that had deliberately chosen *weekly* would silently
come up as *every 1 day* and start writing seven times as many archives as its owner asked
for. `ON CONFLICT(key) DO NOTHING` on every statement means re-running the migration cannot
overwrite a cadence an admin has since changed.

## Why the old key is kept rather than dropped

`backup_interval` is no longer read by any code — `resolveBackupSettings` reads the two new
keys. It is left in the table anyway because its row is the only record inside the database
of what the pre-0138 cadence was, and a rollback that found the key missing would fall back
to a default instead of the reader's actual choice. Its `description` is rewritten to say
it is superseded, so a reader of the table is not left guessing why nothing reads it.

## The sub-minute caveat, inherited

`second` is now offered for backups too, and the scheduler is a fixed **60-second
heartbeat** (`src/instrumentation-node.ts`), so any cadence under a minute fires *once a
minute* and no faster. As with Hello, world!, the stored value is left exactly as entered
rather than clamped on save — the clamp lives in `shouldRunNow` and `nextRunDueAtMs`, and
the admin card says so in words.

A sub-minute backup is a bad idea for reasons that have nothing to do with the heartbeat —
each pass snapshots the database and writes a compressed archive — but the screen states
what will happen rather than silently refusing.

## Where the settings are edited now

**The schedule moved.** It was on Administration → Configuration → Backup Data; it is now on
**Administration → Background Tasks → Configuration → Data backup**, alongside every other
job's switch. Backup Data keeps the two folders and the keep count.

That split is the rule the Background Tasks screen already follows for the Expense importer
and the Stocks refresh: *when* a job runs is administration and lives in one place, *what* it
operates on stays with the thing it belongs to. Each screen now saves only the keys it
renders, so neither can blank a field it never showed.

## Effect on an existing install

**Applying this migration changes no schedule and arms no job.** An install with the backup
switched off stays off; one with it switched on keeps the equivalent cadence through the
translation table above. `DEFAULT_MODULES` is unchanged — no new module, and no new table.

The job key `data_backup` in `sys_scheduled_runs` is untouched, so run history carries across.
