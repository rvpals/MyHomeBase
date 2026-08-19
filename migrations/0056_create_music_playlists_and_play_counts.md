# 0056 - Playlists, play counts, and browse indexes

Adds `mus_playlists`, `mus_playlist_tracks`, `mus_play_events`, two columns on
`mus_tracks` (`play_count`, `last_played_at`), and the indexes the Library module's
browse views need.

## Why

The Library section grew from one list into eight views: All Songs, Artists, Genres,
Playlists, Most Played, Years, Folders and Folder Hierarchy. Six of those are pure reads
over data the scanner already stores. Two are not:

- **Playlists** needed tables. They were designed as part of `0052`, cut before it
  shipped when the module was scoped down to "simply scan, store, stream", and are wanted
  again now. They return with the same shape that was reasoned through then.
- **Most Played** needed something to count. Nothing in the app recorded a play before
  this migration.

## What counts as a play

**Playback starting.** Chosen deliberately by the owner over the alternative below, and
recorded here because the consequence is not obvious from the column name:

| Definition | Consequence |
|---|---|
| **Starting playback** (chosen) | Simple and predictable. But clicking through twenty tracks to find one gives all twenty a play, so `play_count` measures "opened" as much as "listened to". |
| ~30 seconds in (a *scrobble*, as Last.fm and Spotify define it) | Separates listening from browsing. Needs a timer in the player and a guard against double-counting a seek. |

The choice is not permanent. Changing it moves **when the increment fires**, not the
schema, and `mus_play_events` keeps a row per play with a timestamp -- enough to
retro-compute a stricter count over history if the browsing noise ever becomes annoying.

## Why `play_count` is denormalized

Most Played is an ordered top-N. Deriving it as `GROUP BY track_id` over a table with one
row per play means a full aggregate every time the view opens; an indexed counter
(`idx_mus_tracks_play_count`) answers it from the index. `mus_play_events` still exists
because a counter cannot answer "what did I listen to last night", and because it is the
audit trail that makes the definition above reversible.

`mus_play_events.user_id` is nullable on purpose. Play tracking must never be the thing
that fails a playback request, so a play that cannot be attributed is still recorded
rather than dropped or rejected.

## The indexes, and what each is for

| Index | View |
|---|---|
| `idx_mus_tracks_genre` | Genres. NOCASE -- tag capitalisation across 20k files from many sources is not consistent, and "Rock" / "rock" are one genre to a listener. |
| `idx_mus_tracks_release_year` | Years. `release_year` is NULL when untagged, which sorts out of the way instead of landing in year 0. |
| `idx_mus_tracks_path_prefix` | Folders and Folder Hierarchy. The existing unique index on `relative_path` serves an exact lookup; these views run prefix scans over a subtree. |
| `idx_mus_tracks_play_count` | Most Played. DESC with `id` as a tiebreak, so equal counts return in a stable order rather than shuffling between page loads. |

Artists and All Songs are already served by `idx_mus_tracks_artist` from `0052`.

## Playlists: the choices repeated from 0052

**Shared, no `user_id`.** A household library; a playlist someone built is meant to be
playable by anyone with module access. Adding a per-user column later is a migration, but
guessing wrong now would mean every other listener seeing an empty list.

**`position` is explicit** because rowid order cannot express a reorder, and it is
**not** unique per playlist -- a reorder rewrites several rows and a unique index would
fight the intermediate states. Ties break on `id`, which is stable.

**A track may appear twice in one playlist.** A set list can repeat a song, so there is
no unique constraint on `(playlist_id, track_id)`.

## Still read-only where it matters

Nothing here writes to a music file. Playlists, play counts and play history live in the
database; `MusicFileStore` still has no write method.
