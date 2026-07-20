# Migration 0021: create csv_analytics_entries

**Date:** 2026-07-19
**Type:** new table

## What this does

Metadata for the CSV Analysis module's "CSV Analytic entry" feature: a user-defined
name/description plus the shape of a *dynamically created* physical table that holds
that entry's raw CSV data. This migration only creates the metadata table — the
per-entry data table (`csv_<name>`) is created and dropped at runtime by
`SqliteCsvAnalyticsRepository`, not by any migration.

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `name` | `TEXT NOT NULL` | |
| `description` | `TEXT` | nullable, optional |
| `table_name` | `TEXT NOT NULL UNIQUE` | the entry's physical data table, always `csv_`-prefixed |
| `columns_json` | `TEXT NOT NULL DEFAULT '[]'` | JSON array of `{ name, sourceHeader, type }` |
| `primary_key_fields_json` | `TEXT NOT NULL DEFAULT '[]'` | JSON array of column names; empty means the data table uses a surrogate key |
| `created_at` / `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `updated_at` trigger-maintained |

## Deliberate exception: `columns_json` / `primary_key_fields_json`

Same flagged exception as `csv_import_mappings.column_mapping_json` (migration 0019)
and `property_snapshots.raw_data` (migration 0014): a user-defined, variable-shape
column list has no natural relational form here and is replaced wholesale on every
save, never partially edited.

## Row counts are not stored

`rowCount` on the domain type is computed on read via `SELECT COUNT(*) FROM
"<table_name>"` against the entry's data table — storing it would let it drift from
reality on any manual/CLI change to the data table.

## No seed data

Starts empty.

## Rollback

```sql
DROP TRIGGER csv_analytics_entries_set_updated_at;
DROP TABLE csv_analytics_entries;
```

Note: rolling back this migration does **not** drop any `csv_*` data tables created at
runtime by entries — those must be dropped individually (or via each entry's own
delete action) first.
