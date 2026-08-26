# Migration 0063: create sys_dashboard_texture

**Date:** 2026-08-23
**Type:** new table

## What this does

Gives the home dashboard an optional background picture, uploaded by an admin at
**Administration → Configuration → Dashboard Texture**. With no image uploaded
the dashboard renders exactly as it did before — the theme's `--paper` and
nothing else.

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY CHECK (id = 1)` | Single-row settings table |
| `image` | `BLOB` (nullable) | NULL = no texture; the dashboard stays flat |
| `image_mime_type` | `TEXT` (nullable) | NULL alongside a NULL image |
| `opacity` | `REAL NOT NULL DEFAULT 0.10` | `0..1`, CHECK-enforced |
| `mode` | `TEXT NOT NULL DEFAULT 'cover'` | `'cover' \| 'tile'`, CHECK-enforced |
| `blur` | `INTEGER NOT NULL DEFAULT 0` | px, `0..40`, CHECK-enforced |
| `updated_at` | `TEXT NOT NULL` | Cache-buster for the serving route |

No index: one row, read by a constant key.

## Why a table and not `sys_app_settings`

The obvious home for an application-wide setting is `sys_app_settings`, and this
deliberately isn't there. That table is a key/value store whose `value` is
`TEXT NOT NULL` (0002), and it is read on **every authenticated page** — the root
layout pulls `application_name`, `color_theme` and `icon_set` out of it through
`getSetting`. Putting image bytes in it would mean:

- base64, because the column is TEXT — ~33% larger than the bytes;
- that payload loaded and materialised on every page render, for a value only the
  serving route ever needs.

That is the failure mode `0040_add_carousel_image_to_modules.md` was written
about. A separate table keeps the BLOB out of the hot path by construction: the
metadata read names its columns and never mentions `image`.

## Why a single row instead of a collection

There is one dashboard, and the setting is application-wide (like `color_theme`,
unlike a user preference). `CHECK (id = 1)` makes that structural rather than a
convention, so every write is an upsert against a known key and no reader has to
decide which of several rows is the live one.

If per-user textures are ever wanted, this is not the table to extend — that
needs a `user_id` and a different primary key, and it should be its own
migration rather than a nullable column bolted onto this.

## The BLOB obligation

`coding-guide.md` requires that any normal read of a table with a BLOB column use
an explicit column list rather than `SELECT *`. Honoured here:
`SqliteDashboardTextureRepository.getTexture()` selects only the metadata plus
`image IS NOT NULL AS has_image`, and `getTextureImage()` — called by
`src/app/api/dashboard/texture/route.ts` alone — is the single place that reads
the bytes. The domain type carries `hasImage: boolean`, never the buffer, exactly
as `Module.hasCarouselImage` does.

## Why the defaults are so conservative

`opacity` defaults to `0.10` and `blur` to `0`. A picture behind a dashboard
competes with the text on top of it, and the app's only other surface texture —
`.paper-texture` in `globals.css` — deliberately sits at alpha `0.02–0.035`
because "anything heavier turns into corduroy behind small text". The upload
should not ship a legibility regression as its default state; an admin who wants
the picture louder can raise it and see the effect live.

## The design rule this knowingly breaks

`design.md` ("The four elevation classes") states that `.paper-texture` is woven
from translucent black and white only, never a grey, so that it darkens and
lightens whatever the theme supplies instead of imposing a colour of its own. **An
uploaded photograph cannot obey that rule** — it has its own colours and cannot
adapt to Daybreak versus BMS. This is an admin-opt-in exception, and `design.md`
has been amended to say so rather than left contradicting the code.

## Rollback

```sql
DROP TABLE sys_dashboard_texture;
```

Nothing references it; no other table changed.
