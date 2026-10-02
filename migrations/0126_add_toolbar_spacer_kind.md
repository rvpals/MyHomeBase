# Migration 0126: a real separator, and a spacer

**Date:** 2026-10-02
**Type:** constraint change (copy-rename-drop), with a value migration

## What this does

Splits migration 0125's single "flexible space" item kind into **two** kinds, because
they are two different things:

| Kind | What it is | Along the bar | Visible |
|---|---|---|---|
| `separator` | A drawn dividing line between two groups | takes ~1px | **yes** |
| `spacer` | Flexible empty space, pushing what follows to the far end | takes all the slack | no |

| Object | Change |
|---|---|
| `sys_toolbar_items.kind` | CHECK widened to `('menu-item', 'heading', 'separator', 'spacer')` |
| existing `kind = 'separator'` rows | rewritten to `'spacer'` — see below |
| `idx_sys_toolbar_items_order` | recreated (dropping the table drops the index) |

## Why 0125 was not edited instead

0125 is one release old and its `.sql` was still untracked on the dev machine — which
is *precisely* the reasoning that caused the 0114 downtime recorded in
`coding-guide.md`. **Untracked ≠ unapplied.** The dev machine, `C:\webapp` and the NAS
each keep their own `sys_schema_migrations`, and the runner skips a filename it has
already recorded. An edited 0125 would therefore never re-run anywhere it *had* run,
leaving the live table with the narrow constraint while the code inserts `'spacer'` —
a broken deployment no re-run can fix.

The cost of being wrong in this direction is one redundant migration file. That is the
right trade, and the guide says so explicitly.

## Why existing rows become `spacer`, not `separator`

A row already stored as `'separator'` was created under 0125's meaning — *flexible
space*. Leaving it would silently convert every one of them into a drawn line and
change a layout an admin had built. The `CASE` in step 2 re-points them at the kind
that still means what they meant when they were saved.

In practice this is expected to affect **zero rows**: the feature has not shipped and
nothing has been inserted. It is written anyway, because "expected to be empty" is not
a guarantee and a no-op `UPDATE` costs nothing.

## Why copy-rename-drop

SQLite cannot alter a CHECK constraint in place. `coding-guide.md` reserves
`ALTER TABLE ... RENAME TO` for a *pure* rename and prescribes copy-rename-drop for a
constraint change, which is what this is. `id` is carried across explicitly so stored
row ids survive — the reorder call addresses items by id.

## Code that changed with it

Renaming the concept touched the whole feature, since nothing had shipped:

- `TOOLBAR_ITEM_KINDS` gains `spacer`; `ORNAMENTAL_TOOLBAR_KINDS` + `isOrnamentalKind`
  are new, so the four places that test "carries neither a label nor a destination"
  share one definition.
- `trimEdgeSeparators` → `trimEdgeOrnament`. It still drops ornament stranded at
  either end, but now **only collapses a run of the *same* kind** — a separator next
  to a spacer is a deliberate arrangement (divide here, then push the rest along), and
  merging them would change the admin's layout.
- `.personal-toolbar-spacer` keeps the old flex rule; `.personal-toolbar-separator` is
  new and draws per edge, since "across the bar" is a different axis on a horizontal
  bar than a vertical one.
- The separator renders with `role="separator"` rather than `aria-hidden` — it is real
  structure a screen reader should announce, unlike a spacer.

## Rollback

```sql
-- Collapse both kinds back to 0125's single 'separator', then restore the narrow CHECK
-- by the same copy-rename-drop. Note this LOSES the distinction: a drawn separator and
-- a spacer both become flexible space again.
```

Safe in the sense that matters — toolbars are additive chrome, so the worst outcome is
a bar whose dividers turn back into gaps. No navigation is affected.
