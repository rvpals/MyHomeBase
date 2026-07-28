# Migration 0027: create journal (MyJournal) module tables

**Date:** 2026-07-27
**Type:** new tables

## What this does

Creates the core tables for the **MyJournal** module (`journal` module row was
seeded back in migration 0012; only the "Coming soon" placeholder existed until
now). Ported from a standalone SQLCipher journal app and adapted to MyHomeBase
conventions rather than copied verbatim:

| Source style | Adapted to |
|---|---|
| `JOURNAL_`-style names | `jrn_` three-letter prefix (per `coding-guide.md`) |
| camelCase columns (`entryId`, `placeName`, `dtCreated`) | `snake_case` (`entry_id`, `place_name`, `created_at`) |
| random TEXT `generateId()` primary keys | `INTEGER PRIMARY KEY AUTOINCREMENT` (fresh start, no data import) |
| FK + `ON DELETE CASCADE` | no DB-level FK; cascade handled in the repository (project convention) |
| JSON array columns (`categories`, `tags`, `locations`) | normalized into their own tables |
| JSON `weather` object | flattened to four nullable columns on `jrn_entries` |

Deliberately **not** ported (already covered elsewhere or deferred):

- `inspiration` — skipped per request (would otherwise overlap `sys_daily_quotes`).
- `widgets` — deferred per request; not created in this migration.
- `attachments` — deferred per request; not created in this migration.
- `settings` — journal settings belong in the existing `sys_module_settings`.
- `sql_library` — belongs to the SQL Explorer (a platform feature), not this module.
- `schema_version` — migrations are tracked by `sys_schema_migrations`.

## Tables created

### `jrn_entries`
One row per entry. **Multiple entries per date are supported** — `entry_date` is
indexed but never unique; each entry has its own `id` and `entry_time`.

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `entry_date` | `TEXT NOT NULL` | `YYYY-MM-DD` |
| `entry_time` | `TEXT NOT NULL DEFAULT ''` | `HH:MM` |
| `title` | `TEXT NOT NULL DEFAULT ''` | |
| `content` | `TEXT NOT NULL DEFAULT ''` | plain text |
| `place_name` | `TEXT NOT NULL DEFAULT ''` | free-text, e.g. "NYC Trip" |
| `weather_temp` | `REAL` (nullable) | flattened from source `weather` JSON |
| `weather_unit` | `TEXT` (nullable) | |
| `weather_description` | `TEXT` (nullable) | |
| `weather_code` | `INTEGER` (nullable) | |
| `is_pinned` | `INTEGER NOT NULL DEFAULT 0` | 1 = pinned to dashboard |
| `is_locked` | `INTEGER NOT NULL DEFAULT 0` | 1 = editing disabled |
| `created_at` / `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `updated_at` trigger-maintained |

Indexes: `idx_jrn_entries_entry_date`, `idx_jrn_entries_is_pinned`.

### `jrn_categories`, `jrn_tags`
Managed lists, keyed by `name` (the identity referenced from the join tables —
same natural-key precedent as `stk_stock_positions.ticker`). Columns: `name`
(PK), `description`, `created_at`, `updated_at` (trigger-maintained). Tags may
also be created inline while writing an entry.

### `jrn_entry_categories`, `jrn_entry_tags`
Many-to-many pairings between an entry and a category/tag name. Each row = one
pairing. Columns: `id`, `entry_id`, `category_name` / `tag_name`, `created_at`.
A **unique** index on `(entry_id, category_name)` / `(entry_id, tag_name)`
prevents duplicate pairings; a second index on `entry_id` serves the "all
categories/tags for an entry" lookup. No FK — the repository deletes an entry's
pairings in the same transaction as the entry.

The CSV importer parses `"tag1, tag2, tag3"` / `"category1, category2"` into
individual rows here.

### `jrn_entry_locations`
GPS coordinates for an entry with an optional name. Columns: `id`, `entry_id`,
`latitude` (REAL), `longitude` (REAL), `location_name` (optional), `sort_order`,
`created_at`. Index on `entry_id`. The importer parses
`"12234.44, -2334.333, pizza hut"` into one row.

### `jrn_entry_images`
Inline image attachments as base64 data URLs. Columns: `id`, `entry_id`, `name`
(original filename), `data` (full image), `thumbnail`, `sort_order`,
`created_at`. Index on `entry_id`.

### `jrn_icons`
Custom PNG icons for categories/tags. Composite primary key
`(icon_type, name)`; `icon_type` is one of `category`, `tag`, `category_hd`,
`tag_hd`. Columns: `data` (PNG data URL), `created_at`, `updated_at`
(trigger-maintained).

## Object-naming note

Unlike the older stock/CSV migrations (whose index and trigger *object* names
kept their pre-prefix source names), these new tables prefix their index and
trigger names with the full `jrn_` table name (e.g.
`idx_jrn_entries_entry_date`, `jrn_entries_set_updated_at`). This is
self-documenting and avoids collisions on the generic source names (`entries`,
`images`), and matches the direction `coding-guide.md` flags as the intended
follow-up for object names.

## No seed data

All tables start empty.

## Rollback

```sql
DROP TABLE jrn_icons;
DROP TABLE jrn_entry_images;
DROP TABLE jrn_entry_locations;
DROP TABLE jrn_entry_tags;
DROP TABLE jrn_entry_categories;
DROP TABLE jrn_tags;
DROP TABLE jrn_categories;
DROP TABLE jrn_entries;
```
