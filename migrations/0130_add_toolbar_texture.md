# Migration 0130: a background texture on a personal toolbar

**Date:** 2026-10-04
**Type:** additive columns (`ALTER TABLE`, no table rebuild)

## What this does

Lets a personal toolbar draw a picture from the **existing** app texture library behind
its shortcuts, at an opacity of its own.

| Object | Change |
|---|---|
| `sys_toolbars.texture_id` | new, `INTEGER` nullable — a pointer into `sys_dashboard_textures` (0113). `NULL` = no texture, which is the default and the common case. |
| `sys_toolbars.texture_opacity` | new, `REAL NOT NULL DEFAULT 0.15`, `CHECK` 0..1 |

No new table, no new 3-letter prefix, and **no image bytes**: the pointer resolves
through `/api/dashboard/texture?id=<n>`, the library's existing session-gated serving
route. Nothing in `DEFAULT_MODULES` changes — this is a display setting on existing
chrome, not a module.

## Why `ALTER TABLE` is enough

Both columns are additive and neither touches an existing CHECK. `coding-guide.md`
reserves copy-rename-drop for *constraint changes* — which is what 0126 and 0127 were
on the sibling `sys_toolbar_items` table, since SQLite cannot alter a CHECK in place.
Adding a column that carries its own CHECK is supported directly, so the cheap form is
the correct one.

## Why `texture_id` is not a foreign key

Project convention is no DB-level foreign keys. Beyond that, migration 0117 made
exactly this call for `sys_module_texture.texture_id` and the reasoning transfers:
deleting a library picture should neither cascade into unrelated chrome nor be blocked
by a bar nobody is currently looking at.

So a pointer is allowed to go **stale**, and `resolveToolbar` treats an unresolvable
one as *no texture* — the same fall-through `resolveAppTexture` already performs for a
module's stale library pointer. The alternative is emitting a layer whose URL 404s,
which shows as a visibly broken bar instead of a plain one.

## Why there is no `texture_mode` column

The library's rows carry `cover` or `tile`. A toolbar stores neither and **always
tiles**.

A personal toolbar is 44px across its short axis. `cover` scales one copy of the
picture to that box, so for most pictures it shows a single sliver — one flat smear of
colour. A column with one usable value is a control an admin can only get wrong, so the
renderer hardcodes `repeat` and the schema is silent.

## Why `texture_opacity` is per-toolbar

This is the one place a toolbar's texture **deliberately diverges** from how a module
draws one, so it is worth being explicit rather than looking like an oversight.

0117 chose "pick Linen, get Linen as it was tuned" — a module's texture reuses the
library row's own opacity, mode and blur, and the migration records the trade that
implies (two modules cannot show one picture at different strengths). That is right for
a module, which fills a viewport.

A 44px strip shows a few hundred square pixels of the same picture, and a background
tuned to `0.10` for a full page is effectively invisible in it. Tuning per bar is
therefore not a nicety here: without it, selecting a texture on a toolbar would often
look indistinguishable from selecting none. Two bars showing one picture at different
strengths is the **intended** outcome in this table, not the thing being avoided.

Blur is not stored for the same reason `mode` isn't — there is nothing in a 44px tile
for a 40px Gaussian to do except erase it.

## Why the texture draws on a pseudo-element

Worth recording, because the obvious implementation is wrong and `globals.css` already
documents the trap for the neighbouring properties.

The texture **cannot** go on `.personal-toolbar`'s `background-image`. The `emboss`
chrome style paints its bevel gradient into that exact property, so a texture set there
would be wiped by whichever chrome style is active — the same collision the CSS records
for setting `background` (the shorthand) over `--toolbar-surface`.

So the layer is a `.personal-toolbar::before`, which is what `[data-app-texture]`
already does for the app-wide background. It composites above the bar's chosen
background colour and below both the bevel and the glyphs, and costs nothing when no
texture is set — the pseudo-element's `background-image` resolves to `none` and the
element is skipped.

## Rollback

```sql
-- SQLite supports dropping a column since 3.35. Both are additive and nothing reads
-- them outside the toolbar feature, so this loses only the texture selections.
ALTER TABLE sys_toolbars DROP COLUMN texture_opacity;
ALTER TABLE sys_toolbars DROP COLUMN texture_id;
```

Safe in the sense that matters: toolbars are additive chrome and a texture is
decoration on top of that, so the worst outcome of a rollback is a set of bars that go
back to a flat fill. No navigation and no reader's visibility preference is affected.
