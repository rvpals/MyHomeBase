# Migration 0012: seed Journal module

**Date:** 2026-07-16
**Type:** data-only (no schema change — `modules` already has every column needed)

## What this does

Adds a third module: Journal, sequence 3, visible.

| Field | Value |
|---|---|
| `slug` | `journal` |
| `short_name` | `Journal` |
| `long_name` | `My Journal` |
| `description` | `A place to keep a journal with daily recordings.` |
| `icon` | `book` |

Also added to `DEFAULT_MODULES` in `src/lib/modules/defaults.ts`, so "Reset to
Default" restores this module instead of deleting it — keep both in sync if
either changes.

## Rollback

`DELETE FROM modules WHERE slug = 'journal';`
