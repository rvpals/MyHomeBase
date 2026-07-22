# Migration 0022: create csv_chart_presets

**Date:** 2026-07-21
**Type:** new table

## What this does

Stores named chart configurations for the CSV Analysis module's Chart builder. Each
CSV Analytic entry can have any number of named presets; a preset captures the full
set of chart-builder options (chart type, x axis, y series, row limit, decimals,
toggles) as an opaque JSON string that the presentation layer serializes and parses.

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `entry_id` | `INTEGER NOT NULL REFERENCES csv_analytics_entries(id) ON DELETE CASCADE` | owning CSV Analytic entry |
| `name` | `TEXT NOT NULL` | user-chosen preset name; unique per entry |
| `options_json` | `TEXT NOT NULL` | JSON blob of the chart-builder options (opaque to `lib`) |
| `created_at` / `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `updated_at` trigger-maintained |

`UNIQUE (entry_id, name)` makes save an upsert-by-name within an entry.

## Deliberate exception: `options_json`

Same flagged exception as `csv_analytics_entries.columns_json` (migration 0021): the
options are a variable-shape, UI-defined bag replaced wholesale on every save, with no
natural relational form — and `lib` treats it as an opaque string, so the domain layer
stays ignorant of the presentation's chart-option shape.

## Foreign key + explicit cleanup

The `ON DELETE CASCADE` documents intent and works if `PRAGMA foreign_keys` is on, but
the app doesn't enable it, so `SqliteCsvAnalyticsRepository.deleteEntry` also deletes an
entry's presets explicitly inside its delete transaction (defense in depth).

## No seed data

Starts empty.

## Rollback

```sql
DROP TRIGGER csv_chart_presets_set_updated_at;
DROP TABLE csv_chart_presets;
```
