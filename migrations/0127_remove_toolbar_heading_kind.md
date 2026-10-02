# Migration 0127: remove the toolbar `heading` kind

**Date:** 2026-10-02
**Type:** constraint change (copy-rename-drop), with a destructive row delete

## What this does

Removes the `heading` toolbar item kind and **deletes any row using it**.

| Object | Change |
|---|---|
| `sys_toolbar_items.kind` | CHECK narrowed to `('menu-item', 'separator', 'spacer')` |
| rows with `kind = 'heading'` | **deleted** |
| `idx_sys_toolbar_items_order` | recreated (dropping the table drops the index) |

## Why

A heading carried its own text to label the shortcuts under it. It doesn't work, and
the geometry says it couldn't have: a toolbar is **44px** thick and every other row is
a single glyph, so a text label either truncates to nothing or forces the bar wider
than `--toolbar-*-height/width` reserves for it. Reported from the real screen as
*"it doesn't show fully"* — exactly the failure that geometry predicts.

A **separator** (migration 0126) does the same grouping job with a mark instead of a
word, and fits by construction: it spans the bar's thickness and takes no room along
it. So grouping survives; only the text-bearing implementation is withdrawn.

## Why the rows are deleted, not converted

Both alternatives lose more:

- **Convert each heading to a separator** — silently changes what an admin built (a
  caption becomes a line, in a position chosen for a caption) and leaves a separator
  wherever someone typed a heading they'd since have removed.
- **Leave the rows** — not an option. The narrowed CHECK would reject them on any
  future write, and `resolveToolbar` no longer has a branch that renders them, so
  they'd be invisible rows visible in the editor and impossible to get rid of.

Deleting is visible, final, and touches no shortcut. The only loss is the heading
text, which was never legible on screen.

**The `DELETE` runs first**, before the table copy. The other order would abort the
migration on any install that actually had a heading row, since the new CHECK rejects
the value being copied.

## `label` stays

The column survives and is still useful — but now **only** as a per-toolbar nickname
for a shortcut, overriding the menu item's own title in the row's tooltip and
accessible name. On a bar of icons the tooltip is the only thing naming a row, so this
matters more than it sounds. It is never drawn as visible text; that was the heading's
job.

## Gaps are handled at render time, not here

Deleting a heading can leave two separators adjacent, or ornament stranded at an end.
Nothing rewrites the stored rows: `trimEdgeOrnament` already collapses adjacent
duplicates and drops ornament at either end when the bar is resolved, so it reads
correctly without a data fix.

## Why a new file rather than editing 0125/0126

Unchanged from what both of those record: a migration is immutable once it has run
**anywhere**, the runner skips a filename it has already recorded, and `git status`
cannot tell you whether the NAS has run one. An edited CHECK would never re-run where
it had already run, leaving the live table accepting a kind the code can no longer
render.

## Code that changed with it

- `TOOLBAR_ITEM_KINDS` loses `heading`; `ORNAMENTAL_TOOLBAR_KINDS` is unchanged but is
  now "everything that is not a shortcut" — kept as its own list anyway, so a future
  data-bearing kind isn't silently treated as ornament by all four call sites.
- `toolbarItemSchema` drops the "give the heading some text" rule.
- `resolveToolbar` loses its heading branch; `ToolbarRow` loses the `<span>` that drew
  the text.
- The admin form drops the Heading option, and its label field is relabelled
  **Name (optional)** with help text explaining it is the tooltip.
- The CLI drops `--heading`.

## Rollback

```sql
-- Restore the wider CHECK by the same copy-rename-drop, adding 'heading' back.
-- NOTE: the deleted heading rows are NOT recoverable from this migration — restore
-- the database if you need them.
```

Toolbars are additive chrome, so the worst case is a bar missing a caption that never
rendered properly. No navigation and no shortcut is affected.
