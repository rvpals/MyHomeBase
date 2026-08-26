# 0060 — Folders as a Magic Playlist criterion

Adds `mus_magic_list.folders_json`: a JSON array of folder paths, alongside the
`genres_json` / `artists_json` / `album_ids_json` that 0057 introduced.

One column, one `ALTER TABLE`, no new table and no new prefix.

## Why

The criteria builder had three pickers, and all three slice the catalog by **tag**:
genre, artist, album. This library's folder layout carries groupings that no tag
records — a box-set rip, a compilation, a "sort this out later" pile. Where the tracks
in such a folder are untagged (and plenty here are), *no* combination of the existing
three pickers can express "everything in that folder". Folders are the fourth axis, and
the one the files are really organised by.

## Why a JSON column, not a child table

The same call 0057 made for genres and artists, for the same reason: a criteria set is
read and written **whole**, every time. The view loads all of it to fill the form; a save
rewrites all of it. A `mus_magic_list_folders` junction table would buy exactly one query
— "which magic lists mention this folder" — that nothing in the product asks, in exchange
for a join on every read and a delete-insert on every write.

## Why paths, not ids

Because there is nothing to hold an id. **A folder is not an entity in this schema.**
`mus_tracks.relative_path` is the only place folders exist at all — the Library's own
Folders and Folder Hierarchy views derive them from that column with a `rtrim`/`replace`
expression rather than reading a table.

So this lands on the text side of 0057's genres-are-text / albums-are-ids split, and
inherits that choice's real cost: moving or renaming a folder on disk orphans the
criterion at the next scan. It degrades gracefully in the same way — the criterion then
matches nothing, and the builder's live candidate count is what turns a suddenly-thin
playlist from "the app is broken" into "that folder is gone". Acceptable for a query
you can re-pick in three clicks.

## What a stored path means: the whole subtree

`Rock` selects everything beneath `Rock`, including `Rock/Queen/Live`. Applied as
`relative_path LIKE 'Rock/%'`.

This is the decision the feature rests on. The picker drills down through the tree, and
most folders worth drilling into — a genre folder, an artist folder — hold nothing but
sub-folders. Under an exact-folder-only reading, ticking one of those would select zero
tracks, and the tree would be a browser you could not actually choose from. Subtree
matching is what makes "pick `Rock`, or drill in and pick just `Rock/Queen`" a real
choice.

The consequence is that a parent and its child are not independent picks: `[Rock,
Rock/Queen]` selects exactly what `[Rock]` selects. The library prunes the redundant
entry before storing (`pruneRedundantFolders`), so a saved list records what the listener
meant rather than a child pick that does nothing.

## How it combines with the other three

Folder paths join the **same selector group** as genres, artists and albums, so
`match_any` governs them identically:

- `match_any = 0` (default): `(genre IN …) AND (artist IN …) AND (album_id IN …) AND (folder LIKE … OR …)`
- `match_any = 1`: all four groups OR-ed together

Within the folder field itself, multiple picks are always OR — same as every other field.

No separate folder-only match mode. A fifth semantics for one field is something the UI
would have to explain forever, and nobody asked for it.

## Migrating existing rows

`NOT NULL DEFAULT '[]'` does the whole job. Every list saved before today reads back as
"no folder restriction", which is exactly what it meant. No backfill and no re-save,
because "an empty criteria list means *no restriction on this field*, never *match
nothing*" has been the rule since 0057 — stated on `MagicCandidateSource.listCandidates`
and enforced in one place, `buildCandidateFilter`. That rule is what carries the old rows
forward untouched.

## Why no new index

A subtree criterion is `relative_path LIKE 'Rock/%'`, which a plain index on
`relative_path` could serve as a range scan — but only when the folder clause is the
selective one, and only if the planner picks it over `idx_mus_tracks_magic_candidates`,
which already covers the two predicates *every* candidate query carries unconditionally
(`duration_seconds IS NOT NULL`, `is_streamable = 1`).

The candidate query is a full pass over ~20k rows of metadata that this module already
accepts materialising in order to shuffle it. An index the planner will usually decline,
and that every scan then has to maintain, is the wrong trade at this size. Worth
revisiting if the catalog grows an order of magnitude.

## Rollback

`ALTER TABLE mus_magic_list DROP COLUMN folders_json;`. Nothing else references it — no
index, no trigger, no other table — and dropping it returns every saved list to
three-criteria behaviour rather than breaking it.
