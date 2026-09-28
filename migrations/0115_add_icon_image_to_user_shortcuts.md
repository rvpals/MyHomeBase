# Migration 0115: uploaded icons for shortcuts

**Date:** 2026-09-27
**Type:** two new columns on an existing table

## What this does

Adds `icon_image` and `icon_mime_type` to `sys_user_shortcuts`, so a shortcut
can show a picture the reader uploaded instead of a glyph from the app's set.

| Object | Shape | Notes |
|---|---|---|
| `sys_user_shortcuts.icon_image` | `BLOB`, nullable | `NULL` = no upload, draw the glyph |
| `sys_user_shortcuts.icon_mime_type` | `TEXT NOT NULL DEFAULT ''` | Empty when there is no upload |

Existing rows get `NULL` and keep drawing their glyph, so **nothing changes on
screen until someone uploads a picture.** No backfill.

## Why this isn't part of 0114 — the mistake worth recording

These columns were briefly folded into 0114 on the reasoning that that file was
still uncommitted, so nothing could have run it.

**That reasoning was wrong, and it broke the deployed app.** Being untracked by
git says nothing about whether a migration has been *applied*. 0114 had already
run on the NAS. The runner records applied filenames in `sys_schema_migrations`
and skips them, so an edited 0114 would never re-run there — the live table kept
the old shape while the code expected the new one, and every home-screen render
failed with:

```
SqliteError: no such column: icon_image
```

The rule, stated plainly: **a migration is immutable once it has run anywhere.**
Check `sys_schema_migrations` — not `git status` — before editing one. An
uncommitted migration is not an unapplied one.

So this is the `exp_categories` 0029 → 0034 two-step that `coding-guide.md`
warns against. It is still the right shape here: the alternative is rewriting
history a deployed database has already applied, which is not a thing a
migration runner can undo.

## Two ways to say what a tile shows

`icon` (a glyph name) and `icon_image` (a picture) answer one question — what
does this tile show — the way `kind` answers "where does it go" two ways.

**The upload wins when present**, and `icon` stays populated underneath it as
the fallback. Removing a picture therefore reveals the glyph rather than
leaving the tile with nothing to draw. There is no state in which a shortcut
has no icon.

## The obligation that comes with the BLOB

**Every ordinary read of this table must name its columns and omit the bytes**,
or they ride along on every home-screen render. The repository lists columns
explicitly and derives `has_icon_image` in SQL (`icon_image IS NOT NULL`), so a
caller can choose artwork-or-glyph without ever loading the picture. The serving
route is the single reader of the blob.

## These pictures are private, unlike every other image column

`exp_vendors`, `sys_modules`, `jrn_categories` and the rest hold household-wide
rows, so their routes ask one question: is this reader signed in?

That is **not sufficient here.** These rows are per-user. A route that only
checked for a session would let any signed-in reader walk the ids and pull
everyone else's uploaded pictures. So `/api/shortcuts/<id>/icon` looks the row
up *scoped by the session's user id* — the same user-scoped contract every other
read of this table uses — and another reader's row is simply not found.

It returns **404, not 403**, for someone else's: distinguishing the two would
confirm that a given id is real, which is the enumeration the scoping exists to
prevent.

## Size

The bytes are downscaled to a 128px WebP before they land here — a tile draws
the icon at roughly 28px, so this column holds kilobytes rather than the
multi-megabyte original someone picked off a phone. Storing the original is the
mistake migration 0040 recorded for the module carousel.

The upload is capped at 256 KB before downscaling, checked in the browser as
well as on the server so an oversized file is refused instantly in the app's own
wording rather than becoming a 500.

## Reversing it

SQLite supports `ALTER TABLE ... DROP COLUMN` from 3.35, so
`ALTER TABLE sys_user_shortcuts DROP COLUMN icon_image;` and the same for
`icon_mime_type`. Nothing references these columns outside the shortcuts module.
Dropping them costs every reader their uploaded pictures; the glyphs underneath
are untouched, so every tile still draws.
