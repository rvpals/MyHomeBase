# Migration 0093: Magic Lists for the Picture Gallery

**Date:** 2026-09-13
**Type:** new tables (4), new read-only port method

## What this does

Adds the Picture Gallery's **Magic List** section: a saved *search* over the photo
archive rather than a hand-assembled collection. The reader picks a date range, a file
size band, a minimum resolution and a ceiling on how many pictures they want; the
generator draws at random from everything that matches. The criteria can be named,
described, saved and reloaded; the resulting set can be played as a slideshow, exported
as a zip, or filed into an album.

Four tables, all `pho_`:

| Table | What it holds |
|---|---|
| `pho_magic_list` | One saved set of criteria, with a unique NOCASE name |
| `pho_magic_list_photos` | The set a list last generated, in order |
| `pho_photo_index` | **A cache of file facts** — size, dimensions, capture date, mtime |
| `pho_magic_scan_run` | Progress for one run of the indexer, so the bar has something to poll |

### `pho_magic_list`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PK AUTOINCREMENT` | |
| `name` | `TEXT NOT NULL` | Trimmed, 1–120 chars at the schema boundary |
| `description` | `TEXT NOT NULL DEFAULT ''` | Blank, never NULL |
| `from_date` / `to_date` | `TEXT` | `YYYY-MM-DD`, inclusive. NULL = unbounded that end |
| `min_bytes` / `max_bytes` | `INTEGER` | Bytes. NULL = no bound |
| `min_width` / `min_height` | `INTEGER` | NULL = no bound |
| `max_width` / `max_height` | `INTEGER` | NULL = no bound |
| `max_photos` | `INTEGER NOT NULL DEFAULT 100` | The ceiling on the draw |
| `last_generated_at` | `TEXT` | NULL until generated once |
| `created_at` / `updated_at` | `TEXT NOT NULL` | `datetime('now')`, with an update trigger |

Plus `idx_pho_magic_list_name`, unique on `name COLLATE NOCASE`.

**Every bound is nullable, and NULL means "no restriction on this end"** — not zero and
not infinity. A list with no minimum size must not be a list that matches nothing. That
rule is enforced in exactly one place, `matchesCriteria`, and never re-derived.

### `pho_magic_list_photos`

`magic_list_id`, `relative_path`, `position`. Plus `idx_pho_magic_list_photos_order` on
`(magic_list_id, position, id)`.

### `pho_photo_index`

`relative_path` (unique, case-sensitive), `bytes`, `width`, `height`, `taken_at_date`,
`taken_at_source`, `file_mtime`, `indexed_at`. Plus a partial covering index
`idx_pho_photo_index_candidates` on `(taken_at_date, bytes, id)`
`WHERE taken_at_date IS NOT NULL`.

### `pho_magic_scan_run`

`from_date`, `to_date`, `status`, `files_total`, `files_seen`, `files_indexed`,
`files_cached`, `files_failed`, `current_path`, `last_error`, `started_at`,
`finished_at`, `updated_at`. Plus indexes on `(status, started_at DESC)` and
`(started_at DESC)`.

## Why the archive needed an index, and why it is a table

Size and resolution are **not in any directory listing**. Answering "photographs over
4 MB at 1920×1080 or better, taken in 2019" without a cache means, on every run, a
`stat` plus a 128 KB header read for every file in the range — thousands of round trips
over SMB to the DS223. That is slow enough to make the feature unusable, and it is
repeated work: the facts do not change unless the file does.

So the scan writes them down once. A re-scan of the same range compares size and mtime
against the cached row and skips the file if both match, which is the trick
`0052_create_music_library.md` calls *"the cheap skip that makes a re-scan take seconds
instead of minutes"*. This table is the photo equivalent of `mus_tracks`' cached
`duration_seconds`.

`pho_photo_index` is **a cache, not content.** It is keyed by path, safe to delete
wholesale, and rebuilt by scanning. Nothing the reader created lives in it — saved lists,
albums and favourites are all elsewhere, and none of them reference it by id. That is
deliberate: clearing the index must never be able to empty somebody's saved list, which
is why `pho_magic_list_photos` stores a path rather than an index row id.

## Why this does not violate the archive's read-only rule

[src/lib/journal-photos/ports.ts](../src/lib/journal-photos/ports.ts) states the standing
rule for the photo archive, and it is emphatic: the entire `PhotoFileStore` interface is
read-only and must stay that way, because these are the household's only copies of these
photographs. Among its listed consequences:

> Nothing is written into a photo folder — not a thumbnail cache, not an index, not a
> sidecar.

**That rule is kept in full.** Nothing here writes to the archive. The index is a table
in the application database, which is exactly the escape hatch the same comment
specifies:

> If a future feature genuinely needs a write (a real thumbnail cache is the likely
> one), it needs a separate, explicitly named port and a migration-log entry justifying
> it — not a method here. A cache should live outside the archive anyway.

This migration is that entry. The cache lives outside the archive, in the database.

### The one port change, and why it is still read-only

`PhotoFileStore` gains a single method:

```ts
/** One photo's size and modification time, for the index's skip check. */
statPhoto(relativePath: string): Promise<{ bytes: number; mtime: string } | undefined>;
```

This is an **observation, not a write** — it adds no create, move, rename, delete or
set-times capability, so the property the port exists to guarantee is intact: there is
still no code path from the app to a modification of a photograph, and the type system
still makes one impossible. `stat` is already used inside `file-store.ts` for
`checkRoot`, `folderExists` and `readPhoto`; this exposes the two fields the indexer
needs rather than adding a new kind of access.

Dimensions need **no new I/O at all.** A JPEG's SOF marker sits in the same first bytes
as its EXIF block, so `readHeader(path, EXIF_HEADER_BYTES)` — the existing partial read
the date scanner already performs — carries both. The new `jpeg-size.ts` parser is pure:
bytes in, `{ width, height }` out, no filesystem, testable from fixtures exactly as
`exif.ts` is.

## Why scalar columns here, when `mus_magic_list` chose JSON

`0057_create_music_magic_lists.md` argued at length for storing its criteria as JSON
arrays, and that was right *there*: genres, artists and album ids are **lists**, read and
written whole, and normalising them would have bought three joins for a query nothing in
the product asks.

Every criterion here is a single scalar, and — the deciding difference — they are what
`pho_photo_index` is **queried by**. A date range and a size band as real columns let
SQLite do the filtering through the partial index above. The same values inside a JSON
string would force every indexed row to be read and parsed in JavaScript to answer
"which photographs match", turning an index scan into a full table read. Same module
family, opposite call, because the data is shaped the other way round.

## Why resolution is width and height, not megapixels

"At least 1920×1080" is what a slideshow or wallpaper criterion actually means, and a
megapixel figure cannot express it. A 3000×700 panorama and a 1450×1450 square are both
2.1 MP, and only one of them fills a screen. Storing and filtering the two dimensions
separately is the only way the criterion can mean what the reader intends.

`width` and `height` are nullable, and NULL is **"unknown"**. A resolution criterion
*excludes* an unknown rather than guessing — the same call `mus_tracks` makes for a track
with no `duration_seconds`, which cannot be counted toward a time target.

## Why the capture date, and not the file mtime, drives the range

An archive that has been copied, restored from backup, or re-filed has mtimes from the
day of the copy, not the day of the photograph. Ranging on mtime would quietly make every
date criterion meaningless on exactly the archives most likely to have been moved. So the
range matches `taken_at_date`, resolved the way the rest of the module already resolves
it — EXIF first, then the filename, then the folder name — and `taken_at_source` is
stored alongside so the index stays honest about which kind of evidence produced it.

## Why the scan writes progress to a table

Held in a module variable, progress is lost on a page refresh, invisible to a scan
started from the CLI, and gone entirely if the process restarts mid-run.
`0052_create_music_library.md` reached this conclusion first and this follows it: a row
per run is what lets the view poll "how far along is it" on a one-second interval without
holding a request open, and it is why an interrupted scan can be detected and closed
rather than leaving the button wedged forever.

`files_total` stays 0 while the counting phase walks the range, which the progress bar
renders as **indeterminate** rather than as 0% — the two-phase shape `scanLibrary` uses.

## Rollback

```sql
DROP TABLE pho_magic_scan_run;
DROP TABLE pho_photo_index;
DROP TABLE pho_magic_list_photos;
DROP TABLE pho_magic_list;
```

Dropping `pho_photo_index` costs nothing but a re-scan. Dropping the other three loses
saved lists; no photograph, album or favourite is touched by any of it.
