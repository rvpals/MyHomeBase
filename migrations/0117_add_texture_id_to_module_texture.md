# Migration 0117: a module can pick a texture from the library

**Date:** 2026-09-28
**Type:** two new columns on an existing table, plus a backfill

## What this does

Adds `texture_id` and `texture_mode` to `sys_module_texture`, so each module can
choose what it draws behind its own screens from *Administration →
Configuration → Module Configuration*.

| Object | Shape | Notes |
|---|---|---|
| `sys_module_texture.texture_id` | `INTEGER`, nullable | A `sys_dashboard_textures.id`. Only meaningful when `texture_mode = 'library'` |
| `sys_module_texture.texture_mode` | `TEXT NOT NULL DEFAULT 'inherit'`, CHECKed to four values | Which of the four sources this module draws |

The four modes:

| Mode | Draws |
|---|---|
| `inherit` | the app-wide texture (0116) — the default |
| `library` | `sys_dashboard_textures.id = texture_id`, with that picture's own tuning |
| `own` | this row's own `image` BLOB — what the Music Library does |
| `none` | nothing, **even when an app-wide texture is set** |

## Why a pointer, not a copy of the bytes

The library already holds up to 20 pictures (0113), each with its own opacity,
mode and blur. A module choosing "Linen" wants *that* picture as tuned, so it
stores the id.

Copying the BLOB per module would multiply 4 MB across nine modules for pictures
the admin uploaded once — and re-tuning Linen afterwards would leave every
module holding a stale copy of it.

The consequence, stated plainly: **two modules cannot share one picture at
different opacities.** The knobs belong to the library row. That is the trade
this shape makes, and it is why `own` still exists for a module that genuinely
needs its own tuning.

## Why an explicit mode column

Three of the four states store no bytes in the row, and `inherit` and `none`
store *nothing at all* — no image, no id — yet they must render differently:
one draws the app background, the other deliberately draws nothing.

Inferring the state from which nullable columns happen to be populated would
make those two indistinguishable. That is the same ambiguity 0064's log warns
about for its own `image`/`image_mime_type` pair, so this row says what it means
instead.

`none` is not redundant polish: it is how a dense module — a table-heavy screen
— opts **out** of a background every other screen has.

## Why no foreign key on `texture_id`

This database does not run with foreign keys on; no other table declares one. An
FK here would read like a guarantee while enforcing nothing — the same call 0113
made for `selected_texture_id`.

So the resolver does not trust the column. An id that no longer exists is
treated as `inherit`, which means **deleting a library picture a module was
using degrades that module to the app background** rather than to a broken image
URL.

## The backfill exists to protect the Music Library

`UPDATE sys_module_texture SET texture_mode = 'own' WHERE image IS NOT NULL;`

Without it, the `DEFAULT 'inherit'` would put Music on the app-wide texture and
silently replace a background that was uploaded deliberately from that module's
own configuration screen.

That would be the worst kind of regression: the bytes stay in the row, so
nothing is lost and nothing errors — the screen just quietly shows the wrong
picture until somebody notices.

The guard is `image IS NOT NULL`, not "row exists". 0064 allows a row carrying
only display knobs (an admin who moved the sliders, then removed the picture).
That is not a module with a texture, and it correctly stays on `inherit`.

## Nothing changes on screen

Every other module lands on `inherit`. Combined with 0116 shipping its app-wide
flag **off**, an install that has not ticked that box sees no difference at all,
and one that has sees exactly the background it asked for.

## No BLOB obligation added

`texture_id` and `texture_mode` are a pointer and a label. Reads of this table
still name their columns and derive `image IS NOT NULL AS has_image` rather than
selecting the picture — the discipline `TEXTURE_COLUMNS` has enforced since 0064.
`GET /api/modules/[slug]/texture` remains the only reader of a module's own
bytes, and a `library` module's picture is served by the existing
`GET /api/dashboard/texture?id=<n>` route, which needed no change.

## Reversing it

SQLite supports `ALTER TABLE ... DROP COLUMN` from 3.35:

```sql
ALTER TABLE sys_module_texture DROP COLUMN texture_id;
ALTER TABLE sys_module_texture DROP COLUMN texture_mode;
```

Every module reverts to the pre-0117 rule — its own picture if it has one,
otherwise the app-wide texture. No picture is lost: the library is untouched and
a module's own `image` column is not read or written by this migration beyond
the backfill's `WHERE`. A module that had chosen `none` loses that opt-out and
will start inheriting again.
