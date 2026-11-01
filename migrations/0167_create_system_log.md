# 0167 — Create the system log

## What this does

Adds `sys_system_log`: one row per logged line, each carrying a timestamp, a kind
(`debug` or `operational`), a source, a message and optional detail. One index,
`idx_system_log_recent` on `id DESC`.

## Why

The app had no way to say what it was doing. Three facts made that expensive:

1. **`src/lib/` contains three `console.*` calls in total** — in `auth.ts` and
   `auth-events.ts`. Everything else is silent.
2. The only log a running install can show is **`app.log`**, tailed 50 lines by the
   Server Log tab on Admin → About. It is written by `start.sh` on the NAS, so in
   development on Windows it is empty, and it has no structure to filter by.
3. A background job that misbehaves on the NAS therefore leaves no trace a reader
   can reach — which is the situation `sys_scheduled_runs` (0061) was added to
   improve, and only improved as far as one line per pass.

## Why not one of the two tables that already exist

**Not `sys_messages` (0109).** Every row there increments a household-wide unread
badge and waits to be dismissed. A debugging session writing a line per file would
bury the monitor alerts the bell exists to deliver, and the queue has no scheduled
prune — the age purge is a button an admin presses. The Hello, world! job already
fills it at ~1,440 rows/day; diagnostics would be an order of magnitude worse.

**Not `sys_scheduled_run_history` (0135).** That table answers "how did this pass
go" with exactly one row per pass, which is what makes its dialog readable. A
per-file line would destroy that shape, and it has no place for a line that did not
come from a job at all.

The three channels are kept separate on purpose: a notice for a reader, a record of
a pass, and a log of what the code did.

## Two kinds, not a severity ladder

`debug` and `operational` are independent switches rather than levels of one scale.

- `debug` — lines planted at a specific place while something is being diagnosed.
- `operational` — routine "the system did a thing": a job triggering, a pass ending.

They are wanted at different times and answer different questions: operational alone
to confirm the scheduler is alive on the NAS, debug alone to chase one bug. A ladder
would impose "debug implies operational", which is not how they relate.

## Column notes

- **`created_at` is stamped by the database**, never passed in. Every line carries a
  time — that is what makes it a log — and a parameter is something a caller can
  forget.
- **`kind` has no CHECK constraint.** Validated at the boundary by
  `systemLogKindSchema` instead, for the reason 0142 gave for `module`: a CHECK
  cannot be changed later without rebuilding the table.
- **`source` is free text**, deliberately unlike `sys_messages.module`, which is a
  fixed enum. This is a code location, not a reader-facing filter list; requiring a
  schema edit before a file may log would stop lines being planted when needed.
- **`detail` is blank, never NULL**, per `coding-guide.md`.

## Why one index

Every read is newest-first over the whole table; the screen's filters narrow an
already-bounded page. `id DESC` serves that and the prune without parsing a
timestamp. An index on `kind` was rejected on 0142's reasoning — this table's whole
problem is insert volume, and a second index taxes every insert to speed up a filter
reading a couple of hundred rows.

## Retention

A row cap, enforced by the repository on insert (default 5,000, stored in
`sys_app_settings`). Unlike the message queue this prunes itself, because the
volume is the point: with `operational` on, the Hello, world! job alone writes about
2,880 rows a day.

## Reversal

```sql
DROP TABLE sys_system_log;
```

Loses nothing but the log. Nothing references this table and it references nothing.
With both switches off — the default — nothing writes to it.
