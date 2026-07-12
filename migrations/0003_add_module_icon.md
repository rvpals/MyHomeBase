# Migration 0003: add icon column to modules

**Date:** 2026-07-12
**Type:** simple nullable-with-default column add — plain `ALTER TABLE ADD COLUMN`
is sanctioned for exactly this case (not a structural change, no copy-rename-drop
needed).

## What this does

Adds `icon TEXT NOT NULL DEFAULT 'building'` to `modules`. SQLite backfills the
default into every existing row automatically, so the one seeded module
(`real-estate-investment`) gets `icon = 'building'` without a separate UPDATE.

## Valid values

One of the icon keys in `src/lib/modules/icon-names.ts` (`MODULE_ICON_NAMES`):
`building`, `home`, `briefcase`, `wallet`, `chart`, `folder`, `shield`, `heart`,
`book`, `tool`. Rendered via `src/components/module-icons.tsx`.

Not yet editable from the admin UI (Module Configuration edits name/description/
visibility/order, not icon) — set directly in the table for now.

## Rollback

SQLite can't drop a column pre-3.35; if needed, use the copy-rename-drop pattern
(recreate `modules` without `icon`, copy data, swap, drop old).
