# Migration 0158: a toolbar shortcut that opens in a new tab

**Date:** 2026-10-26
**Type:** additive column (`ALTER TABLE … ADD COLUMN`)

## What this does

Adds `opens_new_tab` to `sys_toolbar_items`. A `menu-item` row with the flag set
renders as a link with `target="_blank"`, so clicking it leaves the current screen
where it is instead of navigating away from it.

| Object | Change |
|---|---|
| `sys_toolbar_items.opens_new_tab` | new `INTEGER NOT NULL DEFAULT 0` |

No new table, no new 3-letter prefix, no index, and nothing in `DEFAULT_MODULES`
changes — this is one more property on chrome that already exists.

## Why a column on the row, not a setting on the toolbar

It is a property of the **destination**, not of the bar.

One bar routinely carries both kinds of shortcut: the screens you move *between*, and
the one or two you keep open *alongside* what you are doing. A per-toolbar switch would
force an admin to create a second toolbar to hold a single new-tab shortcut — structure
nobody would choose if the storage were not pushing them into it.

## Why it is meaningful only on `menu-item`

A separator draws a line and a spacer takes up slack. Neither is clickable, so neither
has anywhere to open.

The column is `NOT NULL DEFAULT 0`, so an ornamental row stores `0` and means nothing
by it. That is the shape `menu_item_id` and `label` already have on this table: the
cross-field rule ("a separator carries no label and no destination") lives in
`toolbarItemSchema`, not in a `CHECK`. Putting it in a `CHECK` here would mean naming
`kind` in a multi-column constraint, which is what makes a later item kind un-addable
without another table rebuild.

## Why an additive `ALTER` and not copy-rename-drop

This adds a column; it does not change a `CHECK`. SQLite supports `ADD COLUMN`
directly, so the rebuild that 0127 and 0153 both needed does not apply here. It is the
same one-line form 0130 used to add `texture_id`. `coding-guide.md` reserves the
rebuild for constraint changes precisely so that an additive column stays cheap.

## Why `NOT NULL DEFAULT 0` rather than nullable

"Not set" and "same tab" are the same thing, and there is no third state to represent.

Every existing row keeps exactly the behaviour it has today without an `UPDATE`,
because `0` **is** today's behaviour. A nullable column would add a null case for every
reader of the row to handle, in order to express nothing.

## Behaviour notes

- The link is rendered with `rel="noopener noreferrer"` alongside `target="_blank"`.
  `noopener` is the one that matters: without it the opened tab gets a handle on the
  opener through `window.opener`. These are same-origin app routes, so this is hygiene
  rather than a fix for a live hole — but it is the default a new `target="_blank"`
  should ship with, not something to add after someone notices.
- A new-tab row is **never** marked as the current page. `aria-current="page"` is
  suppressed on it: the row does not take you anywhere, so highlighting it as where you
  are would be a lie even when the open tab happens to be on that route.
- The flag is set when an item is **added**. There is no edit UI for an existing row
  (the admin screen has never had one — `updateToolbarItemAction` exists and the view
  does not call it), so changing an existing shortcut means removing and re-adding it.
  The CLI's `add-item --new-tab` is the other way in.

## Rollback

```sql
ALTER TABLE sys_toolbar_items DROP COLUMN opens_new_tab;
```

`DROP COLUMN` needs SQLite 3.35+ (2021); on anything older, copy-rename-drop without
the column. Safe either way — every affected row reverts to opening in the current
tab, which is what it did before this migration. No navigation is affected and no
reader preference is touched.
