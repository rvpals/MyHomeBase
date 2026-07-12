# Migration 0002: create app_settings table

**Date:** 2026-07-12
**Type:** new table

## What this does

Creates `app_settings`, a key/value store for application-wide settings edited from
the Administration > Application Configuration screen. Seeded with one row,
`application_name`, which drives the sidebar wordmark and page title.

## Columns

| Column | Type | Notes |
|---|---|---|
| `key` | `TEXT PRIMARY KEY` | setting identifier, e.g. `application_name` |
| `value` | `TEXT NOT NULL` | current value, always stored as text |
| `description` | `TEXT` (nullable) | shown as help text in the admin UI |
| `created_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | |
| `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))`, trigger-maintained | |

**Deliberate exception to "no generic value columns":** this is a genuine key/value
settings store — the whole point is that new settings can be added later without a
schema migration. A dedicated column per setting isn't possible when the set of
settings isn't fully known yet. Revisit if a setting grows real structure of its own
(at that point, give it a real column/table).

## Seed data

One row: `application_name` = `MyHomeBase`. Mirrored in `src/lib/settings/defaults.ts`
— keep both in sync if you change the seed value here.

## Rollback

`DROP TABLE app_settings;` — nothing else references this table yet.
