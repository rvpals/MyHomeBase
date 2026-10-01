# Migration 0121: seed chrome_style setting

**Date:** 2026-09-30
**Type:** data-only (no schema change — `sys_app_settings` already exists)

## What this does

Adds the `chrome_style` row to `sys_app_settings`, holding the border treatment for the
app's chrome — the utility header (`AppHeader`) and the desktop navigation tree
(`NavTree`) — for **Administration → Display Settings → Chrome Style**. The value is one
style id:

```
current | inset | outset | emboss
```

`current` is the default and is the look that shipped before this setting existed: module
slabs carry `.card-embossed`, and the header and tree column are flat with a single
`--line` hairline. The other three apply a bevel to the header *and* the tree column, and
each makes a different choice about the selected row — see `src/lib/settings/chrome-style.ts`
for the catalogue and `src/app/globals.css` for the rules each id selects.

The ids are **permanent**: this row stores one of them, so renaming an id later would read
as a garbled value on every install that had chosen it. `resolveChromeStyle` falls back to
the default rather than throwing, so a stale id degrades to `current` instead of breaking
the chrome — but it still silently loses the admin's choice.

**Why this row exists.** It carries the `description` column, which is what
Administration's settings listing and the CLI read to explain the key — `updateAll`
deliberately writes only `value`, so an upsert can never blank it. It also makes a fresh
install's state match `DEFAULT_APP_SETTINGS` exactly, which is what "Reset to Default"
restores to.

**It is no longer what makes the first save land.** It was, and that broke: `updateAll`
was a plain `UPDATE ... WHERE key = ?`, so on a deployed database this migration had not
yet run against, saving a style affected zero rows, reported success, and came back
unchanged on every refresh. `repo.updateAll` is now an `ON CONFLICT` upsert
(`src/lib/settings/repository.ts`), so a missing row is inserted rather than silently
skipped, and a save no longer depends on migration order. Migration 0067's log describes
the old behaviour and predates that fix.

`INSERT OR IGNORE` so re-running against a DB that already has the row is a no-op.
Mirrored in `src/lib/settings/defaults.ts` (`DEFAULT_APP_SETTINGS`) — keep both in sync.
"Reset to Default" restores this row to `current`.
