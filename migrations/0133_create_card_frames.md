# Migration 0133: nine-slice picture frames for cards

**Date:** 2026-10-08
**Type:** two new tables (`sys_card_frames`, `sys_card_frame`), no changes to existing objects

## What this does

Lets an admin upload a PNG that becomes the **border and background of every
`CustomizableCard`** — a nine-slice (nine-patch) frame. Four slice values cut the picture
into nine pieces: the corners are placed untouched at the card's corners, the four edge
strips run along its sides, and the centre fills behind the content.

| Object | Change |
|---|---|
| `sys_card_frames` | new table — the frame library. `image BLOB NOT NULL`, four slice columns, `fill_opacity`, `fill_mode`, `center_fill`, `sort_order`, `updated_at` |
| `idx_card_frames_sort` | new index on `(sort_order, id)` — the gallery's only ordering |
| `sys_card_frame` | new table — the pinned `id = 1` selection singleton, one nullable `selected_frame_id` |

No new module, so **`DEFAULT_MODULES` is unchanged** — this is a display setting on
existing chrome, the same shape as 0130. Prefix `sys_`, as all application chrome uses.

**Applying this migration changes no screen.** `selected_frame_id` seeds as NULL, which
the renderer reads as "no frame", and every card keeps the `.card-raised` ring and shadow
it has today.

## Why two tables

The same split as 0063/0113. `sys_card_frame` holds only the selection, and it is read on
**every protected render** to emit the CSS custom properties — so it must be answerable
without touching a BLOB. One combined table would mean either joining against a
BLOB-bearing row on every page view, or relying on nobody ever writing `SELECT *`.

## Why a new library and not `sys_dashboard_textures`

A frame is not a texture, and the columns prove it.

A texture is a picture tiled or covered behind a page, tuned with `opacity`, `mode` and
`blur`. A frame is **meaningless without its four slice values**, and a texture is
meaningless with them. Sharing one table would leave half its columns NULL for every row
and force both features to branch on which kind of row they were looking at. The 20-row
cap would also then be shared between two unrelated galleries.

## Why `fill_opacity` and not `opacity`

This is the one naming decision worth recording, because the obvious name is wrong.

The slider dims the **centre fill only** — the card's background. It deliberately does
**not** dim the border. A frame faded to 0.3 reads as a rendering fault; a background
faded to 0.3 reads as intended. A column called `opacity` would invite a future change to
apply it to the whole layer, which is exactly the thing this feature is avoiding.

That decision also shapes the renderer: the centre is painted as a **separate background
layer** rather than with `border-image`'s own `fill` keyword, because `fill` cannot carry
an opacity of its own.

`DEFAULT 1.0`, not the `0.10` a page background defaults to. A background sits behind a
whole viewport of text and has to stay quiet; a card frame is chosen to be seen, and
`0.10` would make a freshly uploaded frame look like a failed upload. Same reasoning 0130
used to pick `0.15` over `0.10` for a 44px toolbar.

## Why `center_fill` is its own column

`fill_opacity = 0` would express the same pixels, but not the same *intent*. "Use this
picture as a border only" and "fade the background all the way out" are different choices,
and the admin screen disables the opacity slider when `center_fill` is off — rather than
leaving a live control that appears to do nothing.

## Why only a lower bound on the slices

A negative slice is never a typo worth explaining — it is simply invalid, so the CHECK
rejects it. The **upper** bound (256px) lives in `schema.ts` instead, because exceeding it
is a plausible mistake that deserves a sentence: the four insets become the card's border
widths, so a 600px slice on a 400px card leaves negative room for content and the browser
silently collapses the centre. The CHECK reports a SQLite error; the schema reports
something the admin screen can show. Same split 0130 documents, and the CLI reaches the
same use-case without passing through the form.

## Why no foreign key on `selected_frame_id`

Project convention is no DB-level foreign keys; 0117 and 0130 made the same call for this
pointer shape.

Here the pointer additionally cannot go stale in practice: `deleteFrame` runs the DELETE
and the selection-clear **in one transaction**. The INNER JOIN in `getSelection()` is the
belt to that braces — a selection naming a missing row yields no row and reads as "no
frame", which renders as the card looked before this migration rather than as a 404ing
image URL.

## Rollback

```sql
DROP INDEX IF EXISTS idx_card_frames_sort;
DROP TABLE IF EXISTS sys_card_frame;
DROP TABLE IF EXISTS sys_card_frames;
```

Safe in the sense that matters: both tables are new, nothing outside the card-frame
feature reads them, and no existing table was altered. Dropping them loses the uploaded
frames and returns every `CustomizableCard` to its theme-drawn border — which is the state
this migration ships in anyway.
