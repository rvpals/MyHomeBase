# Migration 0006: create module_settings table

**Date:** 2026-07-13
**Type:** new table

## What this does

Creates `module_settings`, a per-module key/value store — arbitrary settings
scoped to one module, edited from the "Module Settings [Module Name]"
collapsible card on the Module Configuration screen.

## Naming normalization

Requested as `ModuleSettings` with fields `moduleid, setting key, setting
value, setting description`. Normalized to this project's conventions: table
name snake_case plural (`module_settings`, matching `modules`/`app_settings`),
columns snake_case (`module_id`, `setting_key`, `setting_value`,
`setting_description`).

## Columns

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | internal PK |
| `module_id` | `INTEGER NOT NULL` | which module this setting belongs to. No FK constraint (project convention — relationships are managed in app code), but see the note below about `modules.resetToDefaults`. |
| `setting_key` | `TEXT NOT NULL` | |
| `setting_value` | `TEXT NOT NULL` | |
| `setting_description` | `TEXT` (nullable) | shown as help text in the editor |
| `created_at` / `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `updated_at` trigger-maintained |

`UNIQUE (module_id, setting_key)` — one row per key per module; also serves as
the lookup index for "all settings for module X".

## Important: why `modules.resetToDefaults` changed

Without a FK constraint, resetting the `modules` table by deleting and
re-inserting rows would assign new `id` values even to modules that stayed in
the default set — silently orphaning every row in `module_settings` that
pointed at the old id. `SqliteModuleRepository.resetToDefaults` was changed to
upsert by `slug` instead (`INSERT ... ON CONFLICT(slug) DO UPDATE`), so a
module's `id` — and therefore its settings — survives a reset as long as the
module stays in `DEFAULT_MODULES`. Only modules dropped from the defaults list
get deleted (and their settings become orphaned, which is expected — the
module itself is gone).

## No seed data

Starts empty. Populated via the admin UI (add/edit/remove settings per
module) — there's no factory-default content to seed, and per project
decision, "Reset to Default" does not touch this table.

## Rollback

`DROP TABLE module_settings;`
