# Migration 0113: a library of dashboard textures

**Date:** 2026-09-26
**Type:** new table + new column on an existing one

## What this does

Turns the dashboard background from **one uploaded picture** into a **library of
up to 20**, any one of which can be selected to draw behind the home dashboard.
Each picture carries its own name and its own opacity / layout / blur, so
switching between them restores the way each was tuned rather than re-applying
one shared set of knobs.

Managed at **Administration → Configuration → Dashboard Texture**.

### `sys_dashboard_textures` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `name` | `TEXT NOT NULL` | What the admin calls it; not unique |
| `image` | `BLOB NOT NULL` | A library entry always has bytes — removal is `DELETE` |
| `image_mime_type` | `TEXT NOT NULL` | NOT NULL alongside the image |
| `opacity` | `REAL NOT NULL DEFAULT 0.10` | `0..1`, CHECK-enforced — **per picture** |
| `mode` | `TEXT NOT NULL DEFAULT 'cover'` | `'cover' \| 'tile'`, CHECK-enforced |
| `blur` | `INTEGER NOT NULL DEFAULT 0` | px, `0..40`, CHECK-enforced |
| `sort_order` | `INTEGER NOT NULL DEFAULT 0` | Gallery order; every insert appends |
| `updated_at` | `TEXT NOT NULL` | Cache-buster for the serving route |

`idx_dashboard_textures_sort (sort_order, id)` — the gallery's only listing reads
every row in display order.

### `sys_dashboard_texture` (0063) gains one column

| Column | Type | Notes |
|---|---|---|
| `selected_texture_id` | `INTEGER` (nullable) | Which library row the dashboard draws. NULL = none |

## Why a second table instead of relaxing 0063's `CHECK (id = 1)`

Migration 0063 pinned `sys_dashboard_texture` to a single row and its log states
that this is deliberate — every write is an upsert against a constant key, so no
reader has to decide which of several rows is live. It also says, of a different
extension: *"this is not the table to extend."*

Storing 20 pictures by dropping that CHECK would discard exactly the property
that makes the singleton safe, and would leave *"which row does the dashboard
draw?"* answered by convention rather than by structure. So the roles split:

- **`sys_dashboard_textures`** — the collection. Many rows, each self-contained.
- **`sys_dashboard_texture`** — unchanged in kind. Still one row, still read by a
  constant key, now carrying a pointer instead of bytes.

The dashboard's read stays a single-row lookup that never touches a BLOB.

## Why the display knobs moved onto each picture

`opacity`, `mode` and `blur` were application-wide in 0063, which was right when
there was one picture. With 20 they are a property of the *image*: a dark
photograph needs a far lower opacity than a pale seamless pattern, and a pattern
wants `tile` where a photograph wants `cover`. Sharing one set would mean
re-tuning all three on every switch, and switching back would lose the tuning.

The bounds and defaults are copied from 0063 exactly, because the backfill below
moves a row between the two tables and a texture must not change appearance in
the process.

The three columns on `sys_dashboard_texture` are now unread. They are left in
place rather than dropped — see *Rollback*.

## Why the 20 cap is not a CHECK

SQLite cannot express "at most 20 rows" in a column CHECK; a subquery over the
same table isn't permitted in one. The cap lives in `addDashboardTexture()`,
which is also where it belongs on its own merits: what an admin should see on
hitting the limit is a sentence naming it, not `SQLITE_CONSTRAINT`.

## The BLOB obligation

`coding-guide.md` requires that any normal read of a table with a BLOB column use
an explicit column list rather than `SELECT *`. Honoured, and it matters more
here than in 0063 — that table had one row, this one has twenty:

- `listTextures()` selects the metadata plus `image IS NOT NULL AS has_image`,
  never the bytes. This is what the admin gallery and its thumbnails read.
- `getTexture()` joins the singleton to the selected row for the same metadata
  only. This is the read the **home dashboard** performs on render.
- `getTextureImage(id)` is the single place the bytes are read, called by
  `src/app/api/dashboard/texture/route.ts` alone.

Worst case the table holds 20 × 4 MB. Any `SELECT *` here would put 80 MB
through a page render, so the explicit column lists are load-bearing, not
stylistic.

## No foreign key on `selected_texture_id`

This database does not run with `PRAGMA foreign_keys = ON`, and no other table
declares a `REFERENCES` clause. Adding one here would read like a guarantee
while enforcing nothing. Instead:

- `deleteDashboardTexture()` clears the pointer when it deletes the selected row;
- `getTexture()` treats a dangling id as "nothing selected" and falls back to no
  texture, rather than trusting the column.

## Upgrade behaviour

An install that had already uploaded a texture keeps it: the backfill copies the
picture into the library as **"Texture 1"**, carrying its stored opacity, mode
and blur, and points `selected_texture_id` at it. The dashboard looks identical
after the migration.

An install that never uploaded one inserts no row — the `WHERE image IS NOT NULL`
guard — and the library starts empty, with `selected_texture_id` NULL. That is
the state the dashboard already renders as flat paper.

## Rollback

```sql
DROP INDEX idx_dashboard_textures_sort;
DROP TABLE sys_dashboard_textures;
ALTER TABLE sys_dashboard_texture DROP COLUMN selected_texture_id;
```

This is **lossless for the original picture and lossy for the rest**, and the
migration is written that way on purpose. `sys_dashboard_texture.image` and its
three knobs are deliberately left populated rather than nulled out, so a rollback
finds the pre-migration picture exactly where 0063 put it. Textures added *after*
the migration are lost with the table — there is nowhere in the old schema to put
a second picture, which is the whole reason for this migration.

The cost of that choice is one duplicated image on an upgraded install, carried
until the admin replaces it.
