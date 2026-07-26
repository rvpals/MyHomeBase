# Migration 0023: seed icon_set setting

**Date:** 2026-07-22
**Type:** data-only (no schema change — `app_settings` already exists)

## What this does

Adds the `icon_set` row to `app_settings`, defaulting to `'solar-bold-duotone'`.
Selected from the sets in `src/lib/settings/icon-sets.ts` (`ICON_SETS`) on the
Administration > Configuration > Icons screen. Governs the module icons shown on
the home cards and the sidebar; the actual glyph SVGs live in
`src/components/module-icon-sets.generated.ts`.

`INSERT OR IGNORE` so re-running against a DB that already has the row is a no-op.
Mirrored in `src/lib/settings/defaults.ts` (`DEFAULT_APP_SETTINGS`) — keep both in
sync. "Reset to Default" restores this row to `'solar-bold-duotone'`.

## Rollback

`DELETE FROM app_settings WHERE key = 'icon_set';`
