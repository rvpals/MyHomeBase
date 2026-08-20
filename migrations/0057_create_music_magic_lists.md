# 0057 — Magic Playlists

Adds `mus_magic_list` and `mus_magic_list_tracks`, plus one partial index on
`mus_tracks` for the generator's candidate query.

## Why

The Music Library could browse the catalog eight ways and hold hand-built playlists
(`0056`), but there was no way to say *"give me an hour of Rock or Pop by Michael Jackson
or Luther Vandross"* and have the app assemble it. That is a different kind of list: it is
a **query plus a target running time**, not a sequence someone curated.

## Why a separate table from `mus_playlists`

The obvious alternative was a nullable `criteria_json` column on `mus_playlists`, making a
magic list "a playlist that happens to have criteria". Rejected: half the columns would be
meaningless for either kind of row. A hand-built playlist has no criteria, no target
length and no notion of regenerating; a magic list's track order is disposable output
rather than the thing being curated. Two tables, each fully populated, beats one table
that is half NULL in every row.

The two remain independent — a magic list is not a playlist and does not appear in the
Playlists view. Copying a generated set into a real playlist is a plausible future
affordance and needs no schema change if it is ever wanted.

## Criteria as JSON, not child rows

`genres_json`, `artists_json` and `album_ids_json` are JSON arrays.

A criteria set is read and written **whole**, every time: opening the view loads all of it
to populate the form, and saving rewrites all of it. Three junction tables would buy
exactly one query — "which magic lists mention Rock" — that nothing in the product asks,
in exchange for three joins on every read and three delete-inserts on every write.
`mus_scan_runs.formats_json` (`0052`) made the same call for the same reason.

## Genres and artists as text, albums as ids

This mirrors how the catalog itself stores them, which is what keeps the generated `WHERE`
clause honest:

| Criterion | Stored as | Why |
|---|---|---|
| Genre | Text name | Not an entity anywhere in this schema — a NOCASE text tag on `mus_tracks.genre`. |
| Artist | Text name | Same: `mus_tracks.artist` is free text from the file's tags. |
| Album | `mus_albums.id` | Albums genuinely *are* entities with rows, so an id survives a rename where a stored name would quietly stop matching. |

**The cost of the text choice, stated plainly:** retagging an artist in the files orphans
that criterion on the next scan. It degrades gracefully rather than breaking — the
criterion matches nothing, and the UI reports the candidate count so a newly-thin result
explains itself instead of looking like a bug. That is the right failure mode for a query
the listener can re-pick in four clicks, and it is why no attempt is made to normalise
artists into their own table (which would be a much larger change to the scanner, for a
robustness nobody asked for).

## `match_any`: the AND/OR semantics

The default (`0`) is **OR inside each field, AND across fields** — the owner's stated
intent:

```
(genre = Rock OR genre = Pop) AND (artist = Michael Jackson OR artist = Luther Vandross)
```

`match_any = 1` flips it to OR everything together.

Stored **per list rather than per generation**, because it is part of what the criteria
*mean*. Reloading a saved list must reproduce its own semantics, not inherit whatever the
form happened to have toggled.

The escape hatch exists because AND-across-fields is strict in a way that surprises: in
the example above, if the Vandross tracks are tagged `R&B` rather than `Rock` or `Pop`,
**every one of them is excluded by the genre clause** and the result is MJ-only. That is
correct, and it is also the kind of correct that reads as broken — hence both the toggle
and the candidate count in the UI.

## `streamable_only` defaults to 1 — unlike the rest of the module

Everywhere else in the Music Library, unplayable formats are catalogued and simply greyed
out; `music_skip_unstreamable` is a scan-time preference. Here the default flips, because
a timed playlist is a different context: an APE or WMA in the queue would silently consume
five minutes of a one-hour target and then fail to play. Cataloguing them is useful,
putting them in a play queue is not.

## Untagged durations are excluded, not estimated

`duration_seconds` is NULL when the tag reader could not determine it. Those tracks are
**not candidates at all**. The alternatives were considered and rejected:

| Option | Consequence |
|---|---|
| **Exclude** (chosen) | The target and the reported total are both real. Cost: an untagged track never appears in a Magic Playlist. |
| Count as a nominal 4:00 | Fills the target, but actual runtime drifts from what the UI claims — the one number this feature exists to get roughly right. |
| Include, contribute 0 | The playlist reliably overruns by an unbounded amount. |

`idx_mus_tracks_magic_candidates` is **partial** on exactly this predicate
(`WHERE duration_seconds IS NOT NULL`), so the index is the size of the answer rather than
the size of the table.

## Track order: spacing, not interleaving

The selected set is run through one more pass before it is stored, which spaces the same
artist apart so a playlist does not serve three tracks by one performer in a row. Worth
recording because of what it deliberately is *not*:

- It is a **separate pass from selection**, and a **pure permutation**. Selection decides
  which tracks and owns the time target; ordering cannot change the set, the count or the
  running time. Folding them together would allow a spacing rule to silently drop a track
  and miss the target.
- It is **greedy look-ahead, bounded to a few positions**, not the usual "bucket by artist
  and round-robin" interleave. A full interleave produces a strict A-B-A-B rotation, which
  is predictable in a way a shuffle should not be; reaching arbitrarily far ahead to dodge
  one repeat amounts to re-sorting the playlist by artist.
- **Untagged artists are not a group.** The untagged pile in this library is large and
  unrelated, so spacing it apart would be spacing apart strangers.
- Where a playlist is mostly one artist, adjacency is unavoidable and is left alone -- ten
  tracks by one performer cannot be spaced apart within ten slots.

No schema involvement: `position` stores whatever order the pass produced, exactly as
before.

## Storing the generated tracks

`mus_magic_list_tracks` holds the set a list last generated, and `last_generated_at`
records when — NULL meaning "saved but never rolled", which the view needs to tell an
empty state from a real result.

The criteria alone would have been enough to regenerate, and storing nothing was the
simpler option. It was rejected because **"generate something random" and "play the list I
saved" are different wants**: if every load reshuffled, a set the listener liked could
never be returned to. Storing the output makes loading *replay* it, and Regenerate the
explicit way to re-roll.

Rebuilt **wholesale** on each generate — delete every row for the list, insert the new set
— rather than diffed. A regenerate is a fresh random draw with no relationship to its
predecessor, so there is no meaningful diff, and a delete-insert inside the existing
transaction is both simpler and correct.

`mus_magic_list_tracks.position` is explicit and **not** unique per list, for the reason
`mus_playlist_tracks` documents: a wholesale rebuild would fight a unique index across its
intermediate states. Ties break on `id`, which is stable.

## A saved list can outlive its tracks

A scan prunes files that have vanished from disk, and this table is not cascaded. A stale
`track_id` is therefore handled **on read** — the join drops rows with no surviving track —
so a saved list quietly shrinks rather than erroring. The criteria are the durable thing;
the generated set is a cache with sentimental value.

## No `user_id`

Consistent with `mus_playlists`. This is a household library and a list someone built is
meant to be playable by anyone with module access; `0056`'s reasoning applies unchanged.

## Still read-only where it matters

Nothing here writes to a music file. Criteria, generated sets and timestamps live in the
database; `MusicFileStore` still has no write method.
