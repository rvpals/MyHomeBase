# Migration 0122: seed border_widths setting

**Date:** 2026-09-30
**Type:** data-only (no schema change — `sys_app_settings` already exists)

## What this does

Adds the `border_widths` row to `sys_app_settings`, holding three independently
adjustable border weights in whole pixels for **Administration → Display Settings →
Border Weight**. One row holds all three, encoded as:

```
outline=1,divider=2,line=1
```

| Axis | Reaches |
|---|---|
| `outline` | The chrome's outer edges — the header's bottom rule, the navigation column's right rule, each module slab's outline |
| `divider` | Rules *inside* the navigation column — the filter row's underline, the grouped-section boxes, the filter box's border |
| `line` | Every other `--line` border in the app: cards, tables, inputs, panels, on every screen |

One row rather than three because the three are always read and written together, so one
row means one migration if a fourth axis is ever added. Same approach as `home_widgets`
(migration 0067). The encoding is owned by `resolveBorderWidths` / `borderWidthsToValue`
in `src/lib/settings/border-widths.ts`, so the reader and the writer cannot drift.

The default is `1` on every axis — exactly the weight the app drew before this setting
existed, so a fresh install and an un-migrated one look identical.

**The keys are permanent.** They *are* the stored encoding, so renaming one makes
`resolveBorderWidths` miss it and fall back to 1px, silently dropping that axis on every
install that had set it. Values are clamped to 1–4 on read *and* on write: above 4 the
`rounded-lg`/`rounded-xl` corners used throughout read as lumps rather than curves, and
on the 260px navigation column every extra pixel of rule costs a pixel of label width.

**Why the values are safe to grow.** Tailwind's preflight sets `box-sizing: border-box`
globally, so a thicker border eats into the element rather than growing it. The header
keeps its `h-12`, and the navigation column keeps its `--nav-tree-width` — which
`.app-main`'s `padding-left` derives from, so the content column cannot disagree with it.
No axis shifts layout.

`INSERT OR IGNORE` so re-running against a DB that already has the row is a no-op.
Mirrored in `src/lib/settings/defaults.ts` (`DEFAULT_APP_SETTINGS`) — keep both in sync.
"Reset to Default" restores every axis to 1.

As of migration 0121's fix, `repo.updateAll` is an `ON CONFLICT` upsert, so saving this
setting does not depend on this migration having run first — but the row is still wanted
for its `description` and for reset parity.
