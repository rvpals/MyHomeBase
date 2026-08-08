# Migration 0040: add carousel_image to sys_modules

**Date:** 2026-08-06
**Type:** new columns

## What this does

Gives each module a replaceable high-resolution graphic for the home screen's
`ModuleCarousel`. Without one, the carousel falls back to the module's icon
glyph rendered large, which is what it did before this migration.

| Column | Type | Notes |
|---|---|---|
| `carousel_image` | `BLOB` (nullable) | NULL = no image uploaded; the carousel uses the glyph |
| `carousel_image_mime_type` | `TEXT` (nullable) | NULL alongside a NULL image |

No index: the image is only ever read by exact slug, from one route.

## The obligation this carries, and why it matters more here

`coding-guide.md` says every normal read of a table with a BLOB column must
switch from `SELECT *` to an explicit column list. **On `sys_modules` that is not
a nicety.** This is the most-read table in the app:

- `listModules()` runs in the `(protected)` layout — every authenticated page.
- `getModuleBySlug()` runs on every module route, section route and several
  server actions.

Both were `SELECT *`. Left alone, a 2 MB module image would have been loaded from
SQLite and materialised into a JavaScript object on **every page render in the
app**, for a value no page uses. Both queries now name their columns, and
`SqliteModuleRepository` is the only place that ever selects the blob — in
`getCarouselImage`, called by the serving route alone.

## How the carousel knows an image exists without loading it

The domain `Module` gained `hasCarouselImage: boolean`, computed in SQL:

```sql
carousel_image IS NOT NULL AS has_carousel_image
```

A boolean crosses the boundary; the bytes never do. The carousel renders
`/api/modules/<slug>/carousel-image` when it's true and the glyph when it isn't.

## Constraints enforced in code, not the database

The shared `decodeImageUpload` (`src/lib/shared/image-upload.ts`) allows only
PNG, JPEG, WebP and GIF, and the use-case caps a module image at
**2 MB** (`MAX_CAROUSEL_IMAGE_BYTES`) — larger than the other image columns
(128–512 KB) because this one is displayed at ~200px on a retina screen rather
than as a small icon.

**SVG is excluded on purpose.** These bytes are served from the app's own origin,
so an SVG could carry script and would be a stored-XSS vector. That rule lives in
the shared helper and is not re-derived here.

Images are stored exactly as uploaded — no server-side resizing or re-encoding,
which would mean an image-processing dependency. A 2 MB upload is a 2 MB download
on the home screen; the upload hint suggests around 800×800.

## Rollback

SQLite cannot drop a column in older versions; on 3.35+ this works:

```sql
ALTER TABLE sys_modules DROP COLUMN carousel_image;
ALTER TABLE sys_modules DROP COLUMN carousel_image_mime_type;
```

Otherwise leave the columns in place — they are nullable and unused code-side
once the feature is reverted. Dropping them only discards the uploaded artwork;
the carousel falls back to glyphs.
