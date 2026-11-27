# 0187 — Clip drawing strokes

Adds `drawing_json TEXT` (nullable) to `clp_clip_images` and to its recycle-bin
mirror `clp_recycled_clip_images`. No new table, no new prefix, no change to
`DEFAULT_MODULES`.

## What a drawing is

A clip drawing is **an image that remembers how it was drawn**. The drawing pad
rasterises the strokes to a PNG, and that PNG is stored exactly like a pasted
screenshot: a BLOB row in `clp_clip_images`, served by `/api/clips/images/<id>`,
referenced by an `<img>` in the clip body. The strokes ride along in `drawing_json`
so the pad can reopen the drawing and keep editing it.

So everything that already works for images works for drawings with no new code:
the card, the viewer, the body editor, the size and count caps, the module-access
check on the serving route, and the recycle bin.

## Why not a `clp_clip_drawings` table

A separate table would need its own serving route (or a second branch in the image
route), its own recycle-bin mirror, its own copy and restore statements in both
directions, and a third way for a clip body to reference something. Every one of
those is a place for a drawing to go missing when a clip is binned and restored.
A column on the row that already does all of that costs one `ALTER` per table.

## Why both tables

The recycle bin copies every column a clip owns (0161's whole point). Leaving the
column off the mirror would bring a restored drawing back as a flat picture —
silent loss of the editable half.

## Editing replaces the row, it never rewrites the bytes

The image route serves with `Cache-Control: immutable`, on the promise that a row's
bytes never change. Editing a drawing therefore stores a **new** row, swaps the
`src` in the clip body to point at it, and deletes the old row — all in the
`saveClipDrawing` use-case, so the web app and the CLI cannot disagree about it.

## The JSON

`{ "version": 1, "width": 1200, "height": 900, "strokes": [{ "ink": "blue",
"size": 6, "erase": false, "points": [[x, y], ...] }] }`, validated by
`clipDrawingSchema` in `src/lib/clips/drawing.ts`. `ink` is a key from
`CLIP_DRAWING_INKS`, never a hex. Coordinates are integers in the backing-store
space, so the JSON stays compact.
