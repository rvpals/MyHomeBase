# Migration 0004: seed color_theme setting

**Date:** 2026-07-12
**Type:** data-only (no schema change — `app_settings` already exists)

## What this does

Adds the `color_theme` row to `app_settings`, defaulting to `'brass'` (the
original palette). Selected from the 10 themes in `src/lib/settings/themes.ts`
(`COLOR_THEMES`) on the Administration > Configuration > Color Themes screen.

Mirrored in `src/lib/settings/defaults.ts` (`DEFAULT_APP_SETTINGS`) — keep both
in sync. "Reset to Default" restores this row to `'brass'`.

## Rollback

`DELETE FROM app_settings WHERE key = 'color_theme';`
