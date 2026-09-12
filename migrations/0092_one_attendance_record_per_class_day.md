# 0092 — One attendance register per class per day, and labels on the local clock

Reverses [0049](0049_allow_multiple_attendance_sessions.sql) and restores the
rule [0047](0047_create_attendance_tables.sql) shipped with.

## What was wrong

Two bugs, reported as one symptom ("it shows there are multiple attendance
records").

### 1. Every session label was written from the UTC clock

`repository.saveAttendance` did:

```ts
const recordedAt = new Date().toISOString();
const sessionLabel = recordedAt.slice(11, 16);   // <- UTC HH:MM
```

while `attendance_date` came from `todayIsoLocal()` — the **local** clock. Two
clocks for one event. On this server (UTC−4, EDT) every stored label was four
hours ahead of the truth:

| id | date | stored label | actual local time |
|----|------|--------------|-------------------|
| 1 | 2026-08-16 | `03:01` | 23:01 |
| 7 | 2026-08-17 | `02:58` | 22:58 |
| 9 | 2026-08-21 | `00:42` | 20:42 |
| 10 | 2026-08-24 | `22:23` | 18:23 |
| 18 | 2026-09-11 | `20:39` | 16:39 |

Worse than a cosmetic offset: records 6 and 7 were filed under `2026-08-17` while
their `recorded_at` read `2026-08-18T02:31Z` and `2026-08-18T02:58Z`. Anything
grouping or sorting by `recorded_at` placed them on the following day.

The irony is that [`src/lib/shared/date.ts`](../src/lib/shared/date.ts) opens by
warning against exactly this — "Deliberately not `toISOString().slice(0, 10)`,
which shifts to UTC" — and the attendance repository was the one place that
didn't use the helper.

### 2. Each save appended a new record

0049 dropped the `UNIQUE` index on `(class_id, attendance_date)` on the grounds
that "a morning and an afternoon register are two facts, not a correction of
one". In practice the module is used one-register-per-day, so re-opening a class
showed a **blank** sheet (`presentIds` started empty and was cleared again after
every save) and re-saving left another row behind.

**The two bugs compounded.** A label reading `20:32` for a 16:32 register looks
wrong, which invites a re-save — and every re-save appended. Hence today's
`2026-09-11` ACC 211 row carrying three "sessions" three minutes apart.

## What this migration does

1. **Merges** duplicate registers. Survivor per `(class_id, attendance_date)` is
   the newest `recorded_at` (ties broken on `id`), which matches the "latest
   wins" rule the detail grid already used. Presence is **unioned** across the
   day's rows — a student ticked at 22:31 and missed at 22:58 was there that day
   — and noted actions are unioned and deduplicated. Child rows are deleted
   explicitly, since neither child table declares a `FOREIGN KEY`.
2. **Backfills** every `session_label` from `recorded_at` via SQLite's
   `'localtime'` modifier. Exact, not a guess: `recorded_at` is a valid instant.
3. **Restores** `UNIQUE` on `(class_id, attendance_date)`, which is what makes
   the new upsert safe — without it a race between two saves could still write
   two rows for a day.

### Dry-run against a copy of the deployed database

| | before | after |
|---|---|---|
| records | 17 | 11 |
| entries | 326 | 240 |
| entry_actions | 7 | 6 |
| class/dates with >1 record | 3 | 0 |

Verified on the copy: **no student lost a `present`**, no action was lost, no
orphaned child rows, and a second insert for an existing class/date is now
rejected with a `UNIQUE` constraint error.

The `entry_actions` 7 → 6 is not a loss: student 164's `EX` on `2026-09-11` was
stored twice, once in each of two re-saves of the same register.

### The one lossy case, stated plainly

Merging presence upward means that **if a class genuinely met twice on a date and
a student attended only one sitting, they now read as present for the merged
day.** Accepted deliberately: the three affected class/dates are all
minutes-apart re-saves except `2026-08-17`, and under-recording an attendance is
worse than over-recording one. Deleting instead would have thrown away three
registers whose labels were misleading in the first place.

## The coding-guide carve-out is back

`coding-guide.md` forbids a `DATE` inside a unique index, because at date
granularity two genuinely distinct events collide. That is precisely the
collision wanted here: one-register-per-class-per-day is the rule the feature is
specified on, so a second write is a correction to apply rather than a second
event to keep. 0049 retired this exception; this migration re-instates it.

## Not reversible

The merge discards rows. The deployed database is backed up before this is
applied.
