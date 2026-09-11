# Migration 0087: photo albums for the Picture Gallery

**Date:** 2026-09-10
**Type:** new tables, new module prefix

## What this does

Adds `pho_albums` and `pho_album_photos`, giving the Picture Gallery module a way to
gather photographs from anywhere in the archive into a named, ordered collection. An
album can be created, opened, renamed, deleted, played as a slideshow, and exported as
a zip; a picture can be filed into one straight from the single-photo viewer.

### `pho_albums`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PK AUTOINCREMENT` | |
| `name` | `TEXT NOT NULL` | Trimmed, 1–120 chars at the schema boundary |
| `description` | `TEXT NOT NULL DEFAULT ''` | Blank, never NULL |
| `created_at` / `updated_at` | `TEXT NOT NULL` | `datetime('now')` |

Plus `idx_albums_name`, **unique on `name COLLATE NOCASE`**.

### `pho_album_photos`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PK AUTOINCREMENT` | |
| `album_id` | `INTEGER NOT NULL` | References `pho_albums (id)` |
| `relative_path` | `TEXT NOT NULL` | Path from the photo root, as `sys_fav_photo` stores |
| `sort_order` | `INTEGER NOT NULL` | The album's own sequence, ascending |
| `added_at` | `TEXT NOT NULL` | `datetime('now')` |

Plus `idx_album_photos_unique` (unique on `(album_id, relative_path)`),
`idx_album_photos_order` on `(album_id, sort_order)`, and `idx_album_photos_path` on
`(relative_path)`.

## Why the Picture Gallery gets a prefix now

`modules.md` and `coding-guide.md` both said, deliberately and at length, that Picture
Gallery **owns no table and therefore has no prefix**: it presented the Journal's photo
folder through `journal-photos` and the kept pictures from `fav_photos`, and a third
copy of either would have been a synchronisation problem invented for its own sake.

That reasoning still holds for everything it showed before. An album is the first thing
about this module that is genuinely **its own concept** rather than a view of somebody
else's data — there is nowhere else in the app that "a collection of pictures someone
assembled and named" could live. So the module gains `pho_` and its first two tables,
and the two docs are updated rather than left contradicting the schema.

**The prefix is `pho_` (photo), not `alb_` (album).** A prefix is a *module* namespace,
not an abbreviation of the first table that needs one — the rule `coding-guide.md`
states. Naming it for albums would leave a second Picture Gallery table (say, saved
slideshow settings) either wearing an album-shaped prefix or inventing a third.

## Why an album stores paths, not pictures

The same reason `sys_fav_photo` does, argued in `0073_create_fav_photo.md`: the
photographs live on the NAS and the database records *what has been said about them*.

The load-bearing consequence is that **deleting an album cannot delete a photograph**.
Dropping an album removes its row and its membership rows; every file stays exactly
where it was. A design that copied bytes into an album would make "delete this album" a
question about whether the reader also meant to destroy the originals — which is not a
question a household photo app should ever have to ask.

It also means a picture can be in any number of albums at once, and being in one has no
effect on the archive's folder structure.

## Why `name` is unique, and case-insensitively so

Two albums with the same name are indistinguishable in the section nav and in the
viewer's *Add to album* menu, so a reader who made a second "Croatia" by accident would
have no way to tell which one they were opening — and no way to tell they had made the
mistake. The unique index refuses it.

`COLLATE NOCASE` because "Croatia" and "croatia" are the same failure. The use-case
checks the name first so the reader gets *"There is already an album called Croatia"*
rather than a constraint violation; the index is what keeps that true when two tabs
submit at once, which the check alone cannot.

## The unique index carries no date column

`(album_id, relative_path)` identifies a membership row **exactly** — one photo is in
one album once or not at all. That satisfies `coding-guide.md`'s rule, and is worth
stating explicitly because the rule exists thanks to
`stk_stock_transactions`, where a `UNIQUE` spanning a *date* silently dropped every lot
after the first on a day. Nothing here is unique-on-a-date, and `added_at` is
deliberately outside the index.

## `sort_order` is the point of an album

A folder is ordered by the filesystem; an album is ordered by the person who made it.
That is most of what distinguishes the two, and it is what makes a slideshow worth
playing — so the sequence is stored data rather than something derived from a file name
or a capture date.

Two consequences the repository documents at the call site:

- **Adding appends** after the current `MAX(sort_order)`, so filing a new picture never
  disturbs the order of what is already there.
- **Removing does not renumber.** `sort_order` only has to be *ascending* for reads to
  be correct, so the gaps a delete leaves are unobservable; renumbering would be a
  second write over every surviving row to fix nothing. `setPhotoOrder` makes it
  contiguous again when the reader actually rearranges.

## `ON DELETE CASCADE` is declared, and also done by hand

`pho_album_photos.album_id` declares `REFERENCES pho_albums (id) ON DELETE CASCADE`, and
the repository **still deletes the membership rows explicitly**, both statements in one
transaction.

The cascade genuinely does fire. That is worth stating plainly, because the obvious
assumption is the opposite: SQLite's own default for `PRAGMA foreign_keys` is OFF and
this application never sets it — but `better-sqlite3` turns it ON when it opens a
connection, unlike the `sqlite3` CLI. Checked in both directions before being written
down here.

So the explicit delete is belt-and-braces, and is kept for two reasons. It does not
depend on a driver default that is invisible from the repository file and that would
silently orphan every membership row if a future upgrade changed it. And it matches
every other parent/child delete in this codebase — `jrn_entry_tags`,
`jrn_entry_categories`, `mus_playlist_tracks` — none of which use a cascade at all. One
pattern for "delete a parent" is worth more than a second one that happens to be
shorter.

## Rollback

```sql
DROP TABLE pho_album_photos;
DROP TABLE pho_albums;
```

No other table references these, and no photograph is affected.
