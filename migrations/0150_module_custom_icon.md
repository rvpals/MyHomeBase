# Migration 0150: add a custom uploaded icon to sys_modules

**Date:** 2026-10-16
**Type:** new columns

## What this does

Lets an admin upload artwork to use as a module's icon, instead of picking one of
the seventeen names in `MODULE_ICON_NAMES`. The upload replaces the glyph
everywhere the module identifies itself: the nav tree, the module rail, the
breadcrumb, the modules menu, the compact section panel, the home grid, the
carousel's no-artwork fallback, the Daily Glance and Today in History card
badges, and the SQL Explorer's module group header.

Without an upload nothing changes — the picked glyph renders exactly as before.

| Column | Type | Notes |
|---|---|---|
| `custom_icon` | `BLOB` (nullable) | Raster bytes, normalised to 256px PNG |
| `custom_icon_mime_type` | `TEXT` (nullable) | NULL alongside a NULL blob |
| `custom_icon_svg` | `TEXT` (nullable) | Sanitized **inner** markup — no outer `<svg>` |
| `custom_icon_width` | `INTEGER` (nullable) | The source SVG's viewBox width |
| `custom_icon_height` | `INTEGER` (nullable) | The source SVG's viewBox height |

No index: the payload is only ever read by exact slug, from one route.

## Why a column and not an icon slot

The obvious question, since this app already has a whole slot-override system
(`ico_slot_overrides`, migration 0066) that does exactly "replace the icon in one
place with an upload".

`src/lib/icons/slots.ts` rules this case out in its own header, under *What does
NOT belong here*:

> **A module's own icon.** That is already user-configurable in Admin >
> Configuration > Module Configuration, backed by `sys_modules.icon`; a slot for
> it would be a second, competing way to set one value.

A module's icon is not one *position* — it is one *value* drawn in nine places at
once, which is precisely what a slot is designed not to be. Slotting it would
have meant nine slot ids per module and nine uploads to change one module's
identity, with no way to express "this module looks like this". So the custom
icon extends the value that already exists.

That also settles the set question. Slot overrides are keyed by `(slot, set)` so
a glyph drawn for Solar Bold Duotone never leaks into Lucide. A module icon is
**set-independent**: it is the module's identity rather than a note in a visual
style, and requiring thirteen uploads to cover the sets would make the feature a
chore. Switching icon sets leaves a custom module icon alone.

## The obligation this carries

Same one 0040 spelled out, and it applies with the same force. `sys_modules` is
the most-read table in the app:

- `listModules()` runs in the `(protected)` layout — every authenticated page.
- `getModuleBySlug()` runs on every module route, section route and several
  server actions.

`MODULE_COLUMNS` in `src/lib/modules/repository.ts` therefore reads **presence,
not payload**:

```sql
custom_icon IS NOT NULL         AS has_custom_icon_image,
custom_icon_svg IS NOT NULL     AS has_custom_icon_svg
```

The domain `Module` gained `hasCustomIcon: boolean` and `customIconKind?:
"svg" | "image"` from those two flags, which is everything a renderer needs to
decide between inlining markup, pointing an `<img>` at the route, and drawing the
built-in glyph.

**The SVG markup is not in that list either.** It is small — a few KB — but it is
still per-row text on a table read on every page, and most of those reads
(`getModuleBySlug` on a route, `listModules` for a menu) have no icon to draw.

There are therefore two reads that do touch a payload column, each with one
caller:

- **`listCustomIcons()`** → the `(protected)` layout, once per authenticated
  render, building the map `ModuleIcon` resolves against. It selects the SVG
  markup (which must be inlined to tint) but only `custom_icon IS NOT NULL` for
  a raster, and its `WHERE` means it returns **no rows at all** until somebody
  uploads something.
- **`getCustomIcon(slug)`** → `/api/modules/<slug>/icon`, the serving route, and
  the only thing that ever reads the BLOB.

## Why SVG is stored as markup and raster as bytes

Carried over from `0066_create_icon_slot_overrides.md`, which has the full
reasoning. In short: an inlined SVG body inherits `currentColor`, so a custom
icon still tints to the theme accent and to the brass of an active nav row. A
raster served through an `<img>` can never tint, so a PNG module icon will keep
its own colours while the label beside it goes brass. The admin control says so
before the upload rather than after.

SVG is sanitized on write by `sanitizeSvg` — an allowlist of drawing elements and
presentation attributes, with the outer `<svg>` stripped — because these bytes are
served back from this app's own origin. That is also why the shared
`IMAGE_UPLOAD_MIME_TYPES` allowlist excludes SVG: raster uploads go through it
untouched, and SVG takes the markup path instead.

Raster uploads run through the same `normalizeIconImage` pipeline the slot
overrides use: a flattened checkerboard backdrop is turned back into alpha, dead
margin is trimmed, and the result is re-encoded as a 256px PNG. A module icon
renders at 16–20px in the nav, and that pipeline exists because artwork exported
from a design tool is otherwise a muddy grey block at that size.

## No CHECK constraint

`ico_slot_overrides` CHECK-constrains "exactly one payload". This table does not,
because SQLite cannot add a CHECK with `ALTER TABLE`, and rebuilding
`sys_modules` — the most-read table in the app, carrying a 2 MB carousel BLOB per
row — to enforce what one use-case already guarantees is not a trade worth
making. `setModuleCustomIcon` is the only writer and always clears the other
payload in the same `UPDATE`.

## `DEFAULT_MODULES` is unchanged

Deliberately. A seeded module has no custom icon, exactly as it has no carousel
image, and both are omitted from `ModuleSeed` for that reason.

**"Reset to Default" does not clear an upload.** `resetToDefaults` upserts by
slug — it keeps each row's id so `module_settings` rows don't get orphaned — and
its `ON CONFLICT DO UPDATE` lists only the seeded fields. The five columns here
are untouched by it, exactly as `carousel_image` is. So a reset restores a
module's name, description, visibility and glyph *name*, and a custom icon
uploaded over that glyph survives it. Clearing an upload is the Reset button in
the icon control, which is the only thing that claims to do it.

## Rolling back

Dropping the five columns loses the uploads and nothing else. Every module keeps
its `icon` name and renders the built-in glyph again.
