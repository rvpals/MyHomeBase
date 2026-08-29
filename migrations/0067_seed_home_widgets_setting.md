# Migration 0067: seed home_widgets setting

**Date:** 2026-08-28
**Type:** data-only (no schema change — `sys_app_settings` already exists)

## What this does

Adds the `home_widgets` row to `sys_app_settings`, holding the home screen's card
layout for **Administration → Display Settings → Dashboard Widgets**. Value is one
comma-separated ordered list of card ids, a `-` prefix meaning hidden:

```
carousel,-dailyQuote,todayInHistory,randomPhoto,stockGlance
```

The default seeds every card visible, in the order the home screen already drew them.
Ids and their copy live in `src/lib/home-dashboard/types.ts` (`HOME_WIDGET_IDS`); the
encoding is owned by `resolveHomeWidgets` / `homeWidgetsToValue` in the same module, so
the reader and the writer can't drift.

**Why this row has to exist rather than being created on first save.** `updateSettings`
(`src/lib/settings/settings.ts`) goes through `repo.updateAll`, which is a plain
`UPDATE ... WHERE key = ?` — against a database with no `home_widgets` row it silently
affects nothing, so saving a layout would report success and persist nothing. Seeding
is what makes the first save land.

`INSERT OR IGNORE` so re-running against a DB that already has the row is a no-op.
Mirrored in `src/lib/settings/defaults.ts` (`DEFAULT_APP_SETTINGS`) — keep both in sync.
"Reset to Default" restores this row to every card visible in catalogue order.

The layout is **global**, one value for the whole install, like `color_theme` and
`icon_set` beside it — an admin arranges the home screen and every user sees that. A
per-user layout would belong in `sys_user_preferences` (migration 0044) instead and
would need no migration at all; `src/lib/home-dashboard` takes and returns a plain
string precisely so that swap would touch only the route layer.

## Notes

Two of the things the home screen renders are deliberately **not** in the catalogue and
so are unaffected by this row: the one-shot deployment message (`STARTUP_MESSAGE`, which
clears itself once acknowledged) and the failed sign-in alert (a security signal shown
only to admins, only while failures are unreviewed). Neither is a card you arrange.

Card visibility is an **AND** with each card's existing render condition, never an
override — ticking Stock Daily Glance cannot conjure positions that don't exist.

## Rollback

`DELETE FROM sys_app_settings WHERE key = 'home_widgets';`

Harmless to run: `resolveHomeWidgets` falls back to every card visible in catalogue
order when the row is absent, which is exactly the pre-migration home screen.
