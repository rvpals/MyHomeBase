# Migration 0072: index the journal entry import match key

**Date:** 2026-08-29
**Type:** additive index

## What this does

Adds one index supporting the journal CSV importer's duplicate check:

| Index | Table | Columns |
|---|---|---|
| `idx_jrn_entries_match_key` | `jrn_entries` | `entry_date`, `entry_time`, `title` |

Plain `CREATE INDEX IF NOT EXISTS`. No table rebuilt, no column changed,
nothing back-filled.

## Why

`importJournalCsv` now asks `countEntriesMatching({ date, time, title })` once
per distinct key in the file, so re-importing the same export is a no-op instead
of a second full set of entries. That count runs once per distinct day in the
file — a 400-row export covering 400 distinct days runs it 400 times, against a
database file that lives on the NAS over SMB.

Measured with `EXPLAIN QUERY PLAN` on an in-memory copy of the real schema:

```
before:  SEARCH jrn_entries USING INDEX idx_jrn_entries_entry_date
         (entry_date=?)
after:   SEARCH jrn_entries USING COVERING INDEX idx_jrn_entries_match_key
         (entry_date=? AND entry_time=?)
```

So the honest gain is narrower than "scan → seek": `idx_jrn_entries_entry_date`
already narrowed by date, and the win is the extra `entry_time` seek column plus
the index becoming **covering**, so the count never touches the table. On a busy
day — a bulk export of many entries sharing one date — that is the difference
between reading every row for the day and reading none of them.

Note the plan seeks on two of the three indexed columns, not three: `TRIM(title)`
is a function on the column, so SQLite cannot use `title` as a seek key and
applies it as a filter over the rows the first two columns return. Dropping the
`TRIM` earns the third column
(`entry_date=? AND entry_time=? AND title=?`, also covering) — deliberately not
taken, because matching a title that arrived from an earlier import with
trailing whitespace matters more than one seek column on an already-narrow range.

## Why this is not a UNIQUE index

This is the obvious way to make duplicates impossible and it is the wrong tool
here, for three reasons:

1. **0027 explicitly allows them.** Its comment reads: *"Multiple entries per
   calendar date are allowed: `entry_date` is only indexed, never unique; each
   entry has its own id and time."* `entry_time` and `title` both
   `DEFAULT ''`, so two untitled, untimed entries on one day are a legal,
   reachable state. A unique index would retroactively make that illegal.
2. **It would abort on the databases that most need it.** Any existing database
   may already hold duplicate rows — including ones an earlier run of this very
   importer created. `CREATE UNIQUE INDEX` over them fails outright.
3. **Uniqueness here is an import policy, not a data invariant.** Typing the
   same title twice on one day by hand is the writer's business; silently
   importing a file twice is not. Keeping the constraint out of the schema is
   precisely what lets `skipDuplicates: false` exist as a deliberate escape
   hatch, and what leaves manual entry unaffected.

Adding a UNIQUE index to an existing SQLite table also requires the full
create-copy-drop rebuild — a poor trade for a rule the importer already enforces
in code, where it can be turned off per import.

## What this migration deliberately does not do

- **Does not drop `idx_jrn_entries_entry_date` (0027).** The new index leads with
  `entry_date` and could serve the calendar's `BETWEEN` query too, so the old one
  is arguably redundant. But this migration ships alongside a behaviour change,
  and retiring an index the calendar depends on deserves its own change where it
  can be judged on its own evidence.
- **No `NOCASE` collation.** The index matches the columns' declared collation
  (BINARY). Title matching is case-sensitive by design: a re-titled entry is a
  different entry. Verified: `'Beach day  '` and `'Beach day'` both match a
  `'Beach day'` key (2 hits), while `'beach day'` matches neither (0 hits).

## Rollback

```sql
DROP INDEX IF EXISTS idx_jrn_entries_match_key;
```

Dropping an index cannot lose data — it only returns the count to a scan. The
importer's dedupe keeps working, just slower.
