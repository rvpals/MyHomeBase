# Migration 0001: create modules table

**Date:** 2026-07-12
**Type:** new table (the copy-rename-drop pattern doesn't apply — nothing to preserve)

## What this does

Creates `modules`, the definitive source of truth and registry for the application's
modules. The sidebar and home screen both read from this table instead of a static
list. Adds an `updated_at` auto-touch trigger since rows are editable (`sequence`,
`is_visible`). Seeds one row for the module that exists today.

## Columns

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | internal PK |
| `slug` | `TEXT NOT NULL UNIQUE` | routing identifier (`/modules/<slug>`) — added beyond the original ask because the app needs a stable URL segment independent of the display names |
| `short_name` | `TEXT NOT NULL` | shown on the left sidebar |
| `long_name` | `TEXT NOT NULL` | shown on the home screen card and the module's own screen |
| `description` | `TEXT` (nullable) | home screen card body; sidebar hover hint |
| `sequence` | `INTEGER NOT NULL` | sort order for sidebar + home screen |
| `is_visible` | `INTEGER NOT NULL DEFAULT 1` (`CHECK IN (0,1)`) | show/hide toggle |
| `created_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | |
| `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))`, trigger-maintained | |

No indexes beyond the unique constraint on `slug` (auto-indexed by SQLite) — row count
is expected to stay in the single digits, so an index on `sequence` would be overhead
with no payoff.

## Seed data

One row: Real Estate Investment (`real-estate-investment`), sequence 1, visible.
`short_name` ("Real Estate") is a placeholder — it wasn't specified; edit it directly
in the table (or via a future admin UI) if a different short name is wanted.

## Rollback

`DROP TABLE modules;` — nothing else references this table yet, so a plain drop is safe.
