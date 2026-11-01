# 0168 — Seed the system log's settings

## What this does

Adds three rows to `sys_app_settings`:

| Key | Default | Meaning |
|---|---|---|
| `system_log_debug` | `false` | Whether DEBUG lines are written |
| `system_log_operational` | `false` | Whether OPERATIONAL lines are written |
| `system_log_max_rows` | `5000` | How many lines the log keeps |

`ON CONFLICT(key) DO NOTHING`, so re-running changes nothing and an install that
already chose its switches keeps them.

## Why app settings, not module settings

The log belongs to no module. It is written by the scheduled-job wrapper in the
composition root, and by whatever code is being diagnosed at the time — which may be
in any module or none. There is no module row to hang the keys off, so they go in the
app-wide store, the same choice 0134 (backup) and 0136 (Hello, world!) made.

## Why the seed exists at all

`SqliteSettingsRepository` upserts, so saving works against keys that were never
stored. The seed is here for the `description` column, which the upsert deliberately
leaves alone — it is the only record inside the database of what each key means, and
it is what Admin → Configuration shows beside the raw rows.

## Where they are edited

**Administration → Configuration → Application Configuration**, beside the upload
cap, cull cap and document limits.

Not on the System Log screen itself, and not on Background Tasks. These are app-wide
switches, which is what the Application Configuration screen is for, and leaving the
viewer free of its own controls is what lets the log be read on a phone without a
settings panel occupying the top of it.

## Why `'true'`/`'false'` and not `'1'`/`'0'`

Matches `hello_world_enabled` (0136), which is what `sys_app_settings` already
carries. The Document Library's *module* settings use `'1'`/`'0'`. Both conventions
exist in this database; each key is read by whichever resolver owns it, so the
inconsistency costs nothing, and converting one would be a migration for a cosmetic
gain. `resolveSystemLogSettings` accepts either spelling so a hand-edited row behaves.

## Why both default off

An install that upgrades into this feature must not start writing a log nobody asked
for — on the NAS that is disk filling quietly, with no screen showing it happen.

The volume is real. With `system_log_operational` on, the Hello, world! job alone
writes about **2,880 rows a day** (a trigger line and a finish line, every minute at
its default cadence). The row cap bounds the table, but turning the switch on should
still be a deliberate act.

## Why there is no auto-off timer

An earlier draft had turning DEBUG on stamp an expiry, reverting the switch after a
few hours as a guard against leaving it on. That was rejected: a switch on a
configuration screen that silently un-sets itself is more surprising than a log that
grew, and the row cap already bounds the cost. If a forgotten switch turns out to be
a real problem, the honest fix is a visible warning on the screen, not a setting that
changes itself.

## Reversal

```sql
DELETE FROM sys_app_settings
 WHERE key IN ('system_log_debug', 'system_log_operational', 'system_log_max_rows');
```

Safe. `resolveSystemLogSettings` degrades every absent key to its default — both
switches off — so removing the rows switches the log off rather than breaking it.
