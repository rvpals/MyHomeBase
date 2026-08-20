-- Music Library: Magic Playlists -- saved selection criteria, and the set they last generated.
--
-- A Magic Playlist is a QUERY, not a hand-built list. The listener picks genres,
-- artists, albums and a target running time; the generator shuffles everything in the
-- catalog that matches and fills toward the target. `mus_playlists` (0056) already
-- covers "a list I assembled by hand" -- this is the other thing, and the two are
-- deliberately separate tables rather than a nullable `criteria_json` bolted onto the
-- existing one. A hand-built playlist has no criteria and a magic list's track order is
-- disposable; one table would have half its columns meaningless for either kind of row.
--
-- No DB-level foreign keys -- the repository maintains the links, per project convention.

-- One saved set of criteria.
--
-- WHY THE CRITERIA ARE JSON AND NOT CHILD ROWS. A criteria set is read and written
-- whole, every single time: the view loads all of it to populate the form, and a save
-- rewrites all of it. Three junction tables (list->genre, list->artist, list->album)
-- would buy exactly one query -- "which magic lists mention Rock" -- that nothing in the
-- product asks, in exchange for three joins on every read and three delete-inserts on
-- every write. `mus_scan_runs.formats_json` (0052) made the same call for the same
-- reason.
--
-- WHY GENRES AND ARTISTS ARE TEXT BUT ALBUMS ARE IDS. This mirrors how the catalog
-- itself stores them, which is what keeps the generated WHERE clause honest. A genre is
-- not an entity anywhere in this schema -- it is a NOCASE text tag on `mus_tracks.genre`
-- -- and the same is true of `artist`. Albums genuinely are entities with rows in
-- `mus_albums`, so storing their ids means a renamed album keeps working where a stored
-- name would quietly stop matching.
--
-- The consequence of the text choice, and it is a real one: renaming or retagging an
-- artist in the files orphans that criterion on the next scan. It degrades gracefully --
-- the criterion simply matches nothing, and the UI reports the candidate count so a
-- newly-thin result explains itself -- which is the right failure for a query you can
-- re-pick in four clicks.
--
-- `match_any` flips the whole predicate between AND-across-fields (the default, and what
-- the owner asked for: `(genre = Rock OR Pop) AND (artist = MJ OR Vandross)`) and
-- OR-everything. Stored per list, not per generation, because it is part of what the
-- criteria MEAN -- reloading a saved list must reproduce its own semantics, not inherit
-- whatever the form last had toggled.
--
-- `streamable_only` defaults to 1, unlike the rest of the module. An APE or WMA file
-- cannot be decoded by any browser, so including one in a timed playlist would silently
-- eat five minutes of a one-hour target and then fail to play. Cataloguing them is
-- useful; putting them in a play queue is not.
CREATE TABLE mus_magic_list (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  description       TEXT    NOT NULL DEFAULT '',
  -- Seconds, not minutes: the generator works in seconds because `duration_seconds`
  -- does, and storing the same unit end to end removes a conversion that could round.
  target_seconds    INTEGER NOT NULL,
  genres_json       TEXT    NOT NULL DEFAULT '[]',   -- JSON array of genre names
  artists_json      TEXT    NOT NULL DEFAULT '[]',   -- JSON array of artist names
  album_ids_json    TEXT    NOT NULL DEFAULT '[]',   -- JSON array of mus_albums.id
  match_any         INTEGER NOT NULL DEFAULT 0,      -- 0 = AND across fields, 1 = OR everything
  streamable_only   INTEGER NOT NULL DEFAULT 1,
  -- NULL until the list has been generated once. Distinguishes "saved but never rolled"
  -- from "generated", which the view needs in order to decide whether it has tracks to
  -- show or an empty state to explain.
  last_generated_at TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One magic list per name, matching `idx_mus_playlists_name`. NOCASE for the same
-- reason: "Friday Night" and "friday night" are one list to a listener, and saving the
-- second should be told it already exists rather than silently making a twin.
CREATE UNIQUE INDEX idx_mus_magic_list_name ON mus_magic_list (name COLLATE NOCASE);

CREATE TRIGGER mus_magic_list_set_updated_at
AFTER UPDATE ON mus_magic_list
FOR EACH ROW
BEGIN
  UPDATE mus_magic_list SET updated_at = datetime('now') WHERE id = old.id;
END;

-- The tracks a list generated, in order.
--
-- WHY THESE ARE STORED AT ALL, given the criteria could regenerate them. Because
-- "generate a random list" and "play the list I saved" are different wants, and only
-- storing the criteria would satisfy the first at the cost of the second: every load
-- would reshuffle, so a set the listener liked could never be returned to. Storing the
-- generated set makes loading REPLAY it, and Regenerate the explicit way to re-roll.
--
-- Rebuilt WHOLESALE on each generate -- delete every row for the list, insert the new
-- set -- rather than diffed against the previous one. A regenerate is a fresh random
-- draw with no relationship to what came before, so there is no meaningful diff to
-- compute and a delete-insert inside the existing transaction is both simpler and
-- correct.
--
-- A `track_id` here can outlive the track: a scan prunes files that vanished from disk,
-- and this table is not cascaded. That is handled on READ -- the join drops rows with no
-- surviving track -- so a saved list quietly shrinks instead of erroring. The criteria
-- are the durable thing; the generated set is a cache with sentimental value.
CREATE TABLE mus_magic_list_tracks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  magic_list_id INTEGER NOT NULL,               -- -> mus_magic_list.id
  track_id      INTEGER NOT NULL,               -- -> mus_tracks.id
  -- Explicit, like `mus_playlist_tracks.position`, and NOT unique per list: a
  -- delete-insert rebuild would fight a unique index across its intermediate states.
  -- Ties break on id, which is stable.
  position      INTEGER NOT NULL DEFAULT 0
);

-- Reading a magic list is always "its tracks in order".
CREATE INDEX idx_mus_magic_list_tracks_order
  ON mus_magic_list_tracks (magic_list_id, position, id);

-- "Which magic lists hold this track" -- the lookup a scan needs when a file has gone
-- from disk, mirroring idx_mus_playlist_tracks_track.
CREATE INDEX idx_mus_magic_list_tracks_track ON mus_magic_list_tracks (track_id);

-- The generator's candidate query filters on genre and artist together and needs a
-- known duration. `idx_mus_tracks_genre` (0056) and `idx_mus_tracks_artist` (0052) each
-- serve one leg; this partial index covers the shape the generator actually runs -- the
-- eligible-track scan -- and excludes the untagged-duration rows it can never use.
--
-- Partial rather than full on purpose: a track with no duration tag cannot be counted
-- toward a time target, so it is not a candidate at all, and keeping those rows out
-- makes the index the size of the answer instead of the size of the table.
CREATE INDEX idx_mus_tracks_magic_candidates
  ON mus_tracks (genre COLLATE NOCASE, artist COLLATE NOCASE, id)
  WHERE duration_seconds IS NOT NULL;
