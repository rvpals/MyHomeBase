# Migration 0028: add `source` to sys_daily_quotes

**Date:** 2026-07-30
**Type:** additive column

## What this does

Adds a `source` column to `sys_daily_quotes` so a quote can record where it came
from — the citation line the 3-2-1 newsletter prints under each quote, e.g.
*"Letter to his son. Letter IX (April 14, 1747)."* or *"USC Gould School of Law
Commencement Address (May 13, 2007)"*.

Without it the newsletter importer would have to discard those lines, losing the
provenance that makes a quote checkable.

| Column | Type | Notes |
|---|---|---|
| `source` | `TEXT NOT NULL DEFAULT ''` | Empty string means "no source recorded" — the existing seeded quotes and any hand-entered quote simply leave it blank. |

## Why a plain ALTER TABLE

The project's rule is that raw `ALTER TABLE` is only acceptable for adding a
simple column. That's exactly this case: additive, with a default, no change to
any existing column or constraint, so no table rebuild is needed. The
copy-rename-drop pattern would add risk here for no benefit.

Existing rows get `''` from the default, so nothing needs backfilling and no
existing query changes meaning (`SELECT *` callers just see one more column).

## Rollback

SQLite supports dropping a column (3.35+), and nothing depends on it:

```sql
ALTER TABLE sys_daily_quotes DROP COLUMN source;
```
