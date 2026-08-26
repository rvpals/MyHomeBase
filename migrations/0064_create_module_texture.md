# Migration 0064: create sys_module_texture

**Date:** 2026-08-25
**Type:** new table

## What this does

Gives any module an optional background picture, uploaded from that module's own
configuration screen. The **Music Library** is the first to use it
(**My Music Library → Configuration → Background picture**), and the picture sits
behind every section of that module — Library, Scan, Magic, Queue, Configuration.

With no image uploaded a module renders exactly as it did before: the theme's
`--paper` and nothing else. No row at all is the default state.

| Column | Type | Notes |
|---|---|---|
| `module_slug` | `TEXT PRIMARY KEY` | e.g. `'music-library'`; one row per module |
| `image` | `BLOB` (nullable) | NULL = no texture; the module stays flat |
| `image_mime_type` | `TEXT` (nullable) | NULL alongside a NULL image |
| `opacity` | `REAL NOT NULL DEFAULT 0.10` | `0..1`, CHECK-enforced |
| `mode` | `TEXT NOT NULL DEFAULT 'cover'` | `'cover' \| 'tile'`, CHECK-enforced |
| `blur` | `INTEGER NOT NULL DEFAULT 0` | px, `0..40`, CHECK-enforced |
| `updated_at` | `TEXT NOT NULL` | Cache-buster for the serving route |

No index: the primary key *is* the lookup. Every read is
`WHERE module_slug = ?`.

## Why a new table rather than the three obvious alternatives

**Not `sys_module_settings`.** Module settings already live there as key/value
rows (`music_scan_extensions`, `music_skip_unstreamable`…), so that is where a
reader looks first and the omission needs justifying. Its `value` column is
`TEXT NOT NULL` (0006), so a picture would have to be base64 — ~33% larger, in a
table read whenever a module screen renders its settings, for bytes only one
route ever wants. That is the mistake `0040_add_carousel_image_to_modules.md`
documents. The *knobs* could have gone there with the BLOB here, but splitting
one feature across two tables buys nothing: a texture with no image is just a row
with NULL bytes.

**Not a column on `sys_modules`.** That table is read on every authenticated page
to build the module rail, and `MODULE_COLUMNS` exists specifically to keep the
carousel BLOB out of that read (0040). A second BLOB would be a second column
every one of those reads must remember to exclude. A separate table cannot be got
wrong by omission.

**Not an extension of `sys_dashboard_texture` (0063).** That is a single-row
singleton pinned by `CHECK (id = 1)` because there is exactly one dashboard, and
the home screen is not a module — it has no slug. Reshaping it into a keyed table
would be a data migration for no user-visible gain. The two tables share a
*library shape* (`src/lib/module-texture/` mirrors `src/lib/dashboard-texture/`)
rather than storage; see the open question below.

## Why keyed by slug

The slug is the stable public identifier — it appears in URLs, in the module
registry and in `DEFAULT_MODULES`. Deliberately **not** a foreign key to
`sys_modules.id`: a module row can be reseeded, while the slug survives. A
texture row for a module that no longer exists is inert rather than corrupt —
nothing reads it, and it costs one row.

## Why no seed row

0063 seeds its single row so the admin screen always has something to edit. Here
a *missing* row is meaningful: it says this module has no texture. The
repository's fallback supplies the display defaults for that case, so every read
still gets a well-formed answer. Seeding would write rows for every module that
will never have a picture.

## Defaults chosen for legibility

`opacity` defaults to `0.10`, near the floor, matching 0063 and for the same
reason: a photograph behind a module's track lists and tables competes with the
text over it. `.paper-texture` in `globals.css` — the app's only other surface
texture — sits at 0.02–0.035. An admin can raise it; the app should not ship a
legibility problem as its default.

## Reversibility

`DROP TABLE sys_module_texture;` — no other table references it, and no other
table was altered. Dropping it removes every module's picture and returns each
to the theme's flat paper.
