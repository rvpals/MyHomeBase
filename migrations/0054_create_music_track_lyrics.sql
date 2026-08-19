-- Music Library: cached lyrics, fetched on demand from LRCLIB.
--
-- Lyrics live in their own table rather than as columns on mus_tracks for two
-- reasons. A lyric body is a few kilobytes of text against a track row that is read
-- in pages of fifty on the library screen, so it would ride along in every browse
-- query. And the fetch has states a nullable text column cannot express -- "never
-- asked", "asked and this song has no words", "asked and nobody has them" are three
-- different things and only one of them should ever be retried.
--
-- Fetched ONLY when the listener presses the lyrics button, then cached forever.
-- Never during a scan: 20,272 tracks would mean 20,272 requests to a free service
-- that asks for nothing in return, which is not a reasonable way to treat it.

-- One row per track that has been asked about.
--
-- `status` is the whole point of the table:
--   'found'        -- `lyrics` holds the words.
--   'instrumental' -- LRCLIB knows the track and says it has no words. A real
--                     answer, not a failure, and must never be retried.
--   'not_found'    -- nobody has lyrics for it. Retryable, because the database
--                     LRCLIB serves is community-contributed and grows.
--   'failed'       -- the request itself failed (offline NAS, service down).
--                     Retryable, and distinct from 'not_found' so a network blip
--                     is not remembered as "this song has no lyrics".
--
-- `source` records where the words came from. Only 'lrclib' today, but a manually
-- pasted lyric is the obvious next case and it must be distinguishable so a later
-- refetch cannot silently overwrite something typed by hand.
--
-- `search_artist` / `search_title` record what was actually asked, which is not
-- always what the track's tags say -- an untagged file falls back to its filename.
-- Without these, a miss is impossible to diagnose.
CREATE TABLE mus_track_lyrics (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id       INTEGER NOT NULL,               -- -> mus_tracks.id
  status         TEXT    NOT NULL,               -- found | instrumental | not_found | failed
  lyrics         TEXT    NOT NULL DEFAULT '',    -- plain text; '' unless status = 'found'
  source         TEXT    NOT NULL DEFAULT '',    -- 'lrclib', later 'manual'
  search_artist  TEXT    NOT NULL DEFAULT '',    -- what was queried, for diagnosing a miss
  search_title   TEXT    NOT NULL DEFAULT '',
  fetched_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One cached answer per track. A second fetch REPLACES the row rather than adding
-- one -- there is no history worth keeping here, and a unique index makes the
-- upsert honest instead of relying on the caller to delete first.
CREATE UNIQUE INDEX idx_mus_track_lyrics_track ON mus_track_lyrics (track_id);

-- "Which tracks are worth retrying" -- the not_found and failed rows, without
-- scanning a table that will eventually hold a row per track anyone has opened.
CREATE INDEX idx_mus_track_lyrics_status ON mus_track_lyrics (status);

CREATE TRIGGER mus_track_lyrics_set_updated_at
AFTER UPDATE ON mus_track_lyrics
FOR EACH ROW
BEGIN
  UPDATE mus_track_lyrics SET updated_at = datetime('now') WHERE id = old.id;
END;
