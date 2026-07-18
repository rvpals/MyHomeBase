# Migration 0019: create csv_import_mappings and csv_named_mappings

**Date:** 2026-07-18
**Type:** new tables

## What this does

Column-mapping storage for the Stocks & ETFs module's CSV import feature
(Position/Transaction/Performance), ported from the InvestHelp PWA's
`csv_import_mappings`/`csv_named_mappings`.

## `csv_import_mappings`

One row per import type (`Position` | `Transaction` | `Performance`),
`import_type` as the primary key — the mapping used the last time that type
was imported, offered as the starting point next time.

| Column | Type | Notes |
|---|---|---|
| `import_type` | `TEXT PRIMARY KEY` | |
| `column_mapping_json` | `TEXT NOT NULL DEFAULT '{}'` | JSON — CSV column index -> target field name |
| `created_at` / `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `updated_at` trigger-maintained |

## `csv_named_mappings`

Named, reusable presets — a user can save a mapping under a name and pick it
from a list next time, independent of the single "last used" row above.

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | internal PK |
| `name` | `TEXT NOT NULL` | |
| `import_type` | `TEXT NOT NULL` | no FK constraint (project convention) |
| `column_mapping_json` | `TEXT NOT NULL DEFAULT '{}'` | JSON, same shape as above |
| `created_at` / `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `updated_at` trigger-maintained |

`idx_csv_named_mappings_import_type` — the only query pattern is "named
mappings for this import type."

## Deliberate exception: `column_mapping_json`

A column-index-to-field-name map is recomputed/replaced wholesale, not
partially edited, and has no natural relational shape — same flagged
exception as `property_snapshots.raw_data` (migration 0014) and the
analytics cache JSON columns (migration 0018).

## Dropped from the source: `dateFormatJson`

The source app stored a `dateFormatJson` column alongside each mapping, but
nothing in its own code ever reads it back — date parsing there just calls
`new Date(dateStr)` directly. Not ported; if per-column date-format hints
turn out to be needed, add the column then with a real reader for it.

## No seed data

Both tables start empty.

## Rollback

```sql
DROP TABLE csv_named_mappings;
DROP TABLE csv_import_mappings;
```
