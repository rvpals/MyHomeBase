# 0073 — Favourite photographs

Adds `sys_fav_photo`: one row per starred photograph, with a note, plus an index on
`created_at` for the newest-first list.

## Why

The home screen's random photo card draws one picture from anywhere in the archive and
replaces it on the next click. That is the point of the card — but it means a photo you
are glad to have seen is one button press from being gone, and finding it again means
knowing which of ~20 years of folders it came from. There was no way to keep one.

A heart on the card's title bar keeps it; a button beside Refresh reads the kept ones
back, with thumbnails and the notes.

## Why the relative path, not the full one

The request said "the full path". This stores the path **from the configured photo
root** instead — `2019/2019-06 June/IMG_20190609_143501.jpg`, not
`//NAS_DS223/photo/2019/...`.

The photo root is a *setting*, not a constant: `photoStore()` resolves it per call from
the Journal module's `photo_root`, falling back to `MYHOMEBASE_PHOTO_ROOT`. That is
deliberate (correcting the path takes effect on the next click, with no restart). An
absolute key would bake today's mount point into every row, so remounting the share,
renaming the volume, or fixing a typo in the setting would orphan every favourite at
once — and each row would need rewriting to recover.

The relative path is also the app's existing currency for a photo: it is what
`photoRelativePathSchema` validates, what `/api/journal/photos?path=` serves, and what
`PhotoLightbox` is handed. Storing it means a favourite is displayable with no
translation step.

The absolute path remains derivable at any time — `resolvePhotoPath(root, relative)` —
so nothing is lost.

## Why `relative_path` is the primary key

No autoincrement `id`, following `stk_ticker_favorites` (0058) exactly. A favourite has
no identity of its own: the photo *is* the row, there can only be one, and nothing will
reference it by a surrogate key. The toggle becomes an `INSERT`/`DELETE` on a known key
rather than a lookup followed by a write, and "the same photo favourited twice" stops
being a bug class instead of being guarded by a second unique index.

## Why case-sensitive, when 0058 is `COLLATE NOCASE`

The ticker table folds case because `aapl` and `AAPL` are the same symbol. These keys
are filesystem paths, and the archive lives on a Linux NAS where `IMG_1.JPG` and
`img_1.jpg` are two genuinely different files. `COLLATE NOCASE` here would let one
favourite shadow the other, and the second `INSERT` would silently do nothing.

## Why `note` is `NOT NULL DEFAULT ''`

Consistent with the codebase's treatment of optional text, and it means no reader has
to distinguish `NULL` from `''`. Both would render as an empty cell.

The heart does **not** prompt for a note. Starring is the frequent, one-click action —
usually taken because the picture is nice, with nothing to say about it — and a modal
on every press would tax the common case to serve the rare one. The note is edited
inline in the favourites list, where the reader is already looking at the photo and has
a reason to write something.

## No `user_id`

Consistent with `stk_ticker_favorites` (0058), `mus_playlists` (0056) and the rest of
the schema: this is a household app, and the photo archive is shared. A favourited
photograph is a statement about the family album, not about a person.

Stated plainly because it is the reversible-but-annoying kind of choice: adding
`user_id` later is a migration that has to decide who existing rows belong to, but
adding it *now* and guessing wrong means everyone but the first user opens an empty
list.

## No cascade, no cleanup

Nothing prunes a favourite — not deleting the photo, not changing the photo root, not a
share that is offline at read time. A favourite costs one row, and a photo that is
missing today may be a share that is merely unmounted right now; deleting the row would
turn a temporary outage into permanent data loss.

The consequence is that a favourite can outlive its file. That is handled on **read**:
the thumbnail's image request 404s and the row renders with a broken-image placeholder
and its note intact, which is the truthful answer — the reader is told the file is gone
and still has the note saying what it was. Removing it is one click, and theirs to make.
