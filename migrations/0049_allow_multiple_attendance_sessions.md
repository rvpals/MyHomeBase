# Migration 0049: allow several attendance sessions in one day

**Date:** 2026-08-17
**Type:** index change + one added column (no table rebuild)
**Table(s) affected:** `att_attendance_records`

## What this does

Removes the one-record-per-class-per-day constraint, so a class that meets twice
keeps two registers instead of the second overwriting the first.

| Change | Why |
|---|---|
| `DROP INDEX idx_att_attendance_records_class_date` | It was `UNIQUE`, and that uniqueness *was* the overwrite behaviour |
| Recreate the same index **non-unique** | Per-class-per-day reads still need an index; they just must not reject a second session |
| `ADD COLUMN session_label TEXT NOT NULL DEFAULT ''` | A readable `HH:MM` so the new session picker can tell `09:05` from `14:10` |

Neither step rebuilds the table: SQLite drops an index directly, and adding a
`NOT NULL` column *with a default* is an in-place operation. Existing rows are
backfilled from `recorded_at`, which is a full ISO timestamp, so `substr(…, 12, 5)`
is the `HH:MM`.

## This retires the exception 0047 added to the coding guide

`0047_create_attendance_tables.md` argued for a deliberate exception to the
"never put a DATE in a unique index" rule in `coding-guide.md`. The argument was
that attendance has no second event by specification — one register per class per
day — so a collision was the row the write was meant to replace rather than a
real row being dropped.

**That premise is now false.** A class may be registered several times a day, so
the date genuinely does not identify a session, and the general rule applies here
with no carve-out. The exception has been removed from `coding-guide.md`.

Worth keeping in mind as the reason the rule exists at all: this is the same
failure `stk_stock_transactions` hit in `0038` — a unique index spanning a date
silently discarded the second of two genuine same-day rows. The Attendance table
would have done exactly that to an afternoon register.

## What did *not* change

`att_attendance_entries.status` is still `present` | `absent`. The home screen now
starts with nobody marked, but that is a **UI** state, not a stored one: at save
time anyone not marked present is written `absent`, exactly as before. No third
status, and the report's Present/Absent split is unchanged.

## Rollback

Restoring the old behaviour means re-imposing uniqueness, which **fails if any
class already has two sessions on one day** — deduplicate first, keeping whichever
session is authoritative.

```sql
DROP INDEX IF EXISTS idx_att_attendance_records_class_date;
CREATE UNIQUE INDEX idx_att_attendance_records_class_date
  ON att_attendance_records (class_id, attendance_date);
-- session_label can be left in place; it is additive and harmless.
```
