-- Music Library: playlists, play counts, and the indexes the browse views need.
--
-- Adds what the eight Library views require beyond the catalog itself:
--   * Playlists           -> mus_playlists, mus_playlist_tracks
--   * Most Played         -> play_count / last_played_at on mus_tracks, + mus_play_events
--   * Genres, Years       -> indexes; the columns already exist
--   * Artists, Folders    -> served by the existing artist and relative_path indexes
--
-- Playlists were designed in 0052, cut before it shipped ("simply scan, store, stream"),
-- and are now wanted after all. They come back with the same shape that was reasoned
-- through then, so the reasoning is repeated here rather than left in a deleted file.

-- Playlists. SHARED, not per-user: this is a household music library, and a playlist
-- someone built is meant to be playable by anyone who can reach the module. There is
-- deliberately no user_id -- adding one later is a migration, but guessing wrong now
-- would mean every other listener seeing an empty list.
CREATE TABLE mus_playlists (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One playlist per name, so "add to playlist" cannot silently create a duplicate.
CREATE UNIQUE INDEX idx_mus_playlists_name ON mus_playlists (name COLLATE NOCASE);

CREATE TRIGGER mus_playlists_set_updated_at
AFTER UPDATE ON mus_playlists
FOR EACH ROW
BEGIN
  UPDATE mus_playlists SET updated_at = datetime('now') WHERE id = old.id;
END;

-- Tracks in a playlist, in order.
--
-- `position` is an explicit integer rather than relying on insertion order: a playlist
-- is reorderable, and rowid order cannot express a move. NOT unique per playlist -- a
-- reorder rewrites several rows at once and a unique index would fight the intermediate
-- states -- so ordering ties break on id, which is stable.
--
-- The same track MAY appear twice in one playlist (deliberate: a set list can repeat a
-- song), so there is no unique constraint on (playlist_id, track_id).
CREATE TABLE mus_playlist_tracks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id  INTEGER NOT NULL,  -- -> mus_playlists.id
  track_id     INTEGER NOT NULL,  -- -> mus_tracks.id
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Reading a playlist is always "its tracks in order".
CREATE INDEX idx_mus_playlist_tracks_order ON mus_playlist_tracks (playlist_id, position, id);

-- "Which playlists is this track on" -- needed to clean up when a scan finds a file has
-- vanished from disk.
CREATE INDEX idx_mus_playlist_tracks_track ON mus_playlist_tracks (track_id);

-- Play counts, for the Most Played view.
--
-- Denormalized onto mus_tracks rather than derived from mus_play_events with a GROUP BY:
-- Most Played is an ordered top-N over a table that will eventually hold a row per play,
-- and an indexed counter answers that from the index alone.
--
-- WHAT COUNTS AS A PLAY: playback STARTING. That is the owner's explicit choice, and the
-- tradeoff is worth recording -- clicking through twenty tracks looking for one gives all
-- twenty a play, so this column measures "opened" more than "listened to". The usual
-- alternative is a ~30-second threshold (what Last.fm and Spotify call a scrobble), which
-- separates listening from browsing. Switching later needs no schema change: only the
-- moment the increment fires moves, and mus_play_events keeps enough detail to
-- retro-compute a stricter count if that is ever wanted.
ALTER TABLE mus_tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mus_tracks ADD COLUMN last_played_at TEXT;

-- The Most Played ordering. DESC on the count with the id as a tiebreak, so equal counts
-- come back in a stable order instead of shuffling between page loads.
CREATE INDEX idx_mus_tracks_play_count ON mus_tracks (play_count DESC, id);

-- "Recently played", and the audit trail behind the counter.
--
-- Kept as its own table rather than only a counter because a counter cannot answer "what
-- did I listen to last night", and because it is what makes a stricter definition of a
-- play recoverable later. One row per play; this table grows without bound by design,
-- but a play row is ~30 bytes and a household will not trouble SQLite with it.
CREATE TABLE mus_play_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id   INTEGER NOT NULL,  -- -> mus_tracks.id
  played_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  -- Who listened. Nullable rather than NOT NULL: play tracking must never be the thing
  -- that fails a playback request, so an unattributable play is still recorded.
  user_id    INTEGER
);

-- "What was played recently", newest first.
CREATE INDEX idx_mus_play_events_recent ON mus_play_events (played_at DESC);

-- "How often has this track been played" -- the retro-compute path, and per-track history.
CREATE INDEX idx_mus_play_events_track ON mus_play_events (track_id, played_at DESC);

-- Genres view. NOCASE because "Rock" and "rock" are one genre to a listener, and tag
-- capitalisation across 20k files from many sources is not consistent.
CREATE INDEX idx_mus_tracks_genre ON mus_tracks (genre COLLATE NOCASE);

-- Years view. release_year is NULL for an untagged file, and NULL sorts out of the way
-- rather than landing in year 0.
CREATE INDEX idx_mus_tracks_release_year ON mus_tracks (release_year, artist COLLATE NOCASE);

-- Folders and Folder Hierarchy both group by the containing folder, which is derived from
-- relative_path. The existing unique index on relative_path serves an exact lookup but
-- not a prefix scan with a different leading column, so this one covers the subtree
-- queries both views run.
CREATE INDEX idx_mus_tracks_path_prefix ON mus_tracks (relative_path COLLATE NOCASE);
