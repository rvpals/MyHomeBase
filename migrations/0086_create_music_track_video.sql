-- Music Library: cached YouTube video picks, fetched on demand from youtube.com.
--
-- The same shape as mus_track_lyrics (0054) and for the same reasons: a lookup has
-- states a nullable column cannot express, and the payload has no business riding
-- along in a browse query that reads fifty tracks at a time.
--
-- Fetched ONLY when the listener presses "Find video" on the player's Video tab, then
-- cached. Never during a scan -- 20,272 tracks would mean 20,272 scrapes of a service
-- that charges nothing and owes us nothing, which is not a reasonable way to behave.
-- The button is explicit rather than automatic for exactly this reason.

-- One row per track that has been asked about.
--
-- `status` carries the retry policy, as in 0054:
--   'found'     -- `video_id` holds the pick.
--   'not_found' -- YouTube returned nothing worth standing behind. Retryable: the
--                  catalogue grows, and the ranking rules in src/lib/youtube may
--                  themselves have been too strict.
--   'failed'    -- the request could not be made (offline NAS, YouTube unreachable,
--                  or a reshaped payload our parser no longer reads). Retryable, and
--                  distinct from 'not_found' so a network blip is never remembered as
--                  "there is no video for this song".
--
-- There is no 'instrumental'-style terminal miss here. Lyrics has one because LRCLIB
-- can authoritatively say a track has no words; YouTube can never say a song has no
-- video, only that we did not find one. So every miss stays retryable.
--
-- `source` records who chose the video. 'youtube' is the automatic pick; a
-- hand-pinned id is the obvious next case and must be distinguishable so a later
-- refetch cannot silently overwrite something chosen deliberately.
--
-- `video_title` and `channel` are stored as YouTube reported them at fetch time --
-- via oEmbed, which is the official endpoint and outranks the scraped title. They are
-- a snapshot, not a source of truth: a re-uploaded video can change both, which is
-- what `fetched_at` is for.
--
-- `search_artist` / `search_title` record what was actually queried, which is not
-- always what the tags say -- an untagged file falls back to its filename. Without
-- these, a wrong pick is impossible to diagnose.
CREATE TABLE mus_track_video (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id         INTEGER NOT NULL,               -- -> mus_tracks.id
  status           TEXT    NOT NULL,               -- found | not_found | failed
  video_id         TEXT    NOT NULL DEFAULT '',    -- 11-char YouTube id; '' unless found
  video_title      TEXT    NOT NULL DEFAULT '',    -- as YouTube reported it, at fetch time
  channel          TEXT    NOT NULL DEFAULT '',    -- uploading channel, e.g. billyjoelVEVO
  duration_seconds INTEGER,                        -- NULL for a live stream, which has no length
  source           TEXT    NOT NULL DEFAULT '',    -- 'youtube', later 'manual'
  search_artist    TEXT    NOT NULL DEFAULT '',    -- what was queried, for diagnosing a bad pick
  search_title     TEXT    NOT NULL DEFAULT '',
  fetched_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One cached answer per track. A second fetch REPLACES the row rather than adding
-- one -- there is no history worth keeping here, and a unique index makes the upsert
-- honest instead of relying on the caller to delete first.
CREATE UNIQUE INDEX idx_mus_track_video_track ON mus_track_video (track_id);

-- "Which tracks are worth retrying" -- the not_found and failed rows, without
-- scanning a table that will eventually hold a row per track anyone has opened.
CREATE INDEX idx_mus_track_video_status ON mus_track_video (status);

CREATE TRIGGER mus_track_video_set_updated_at
AFTER UPDATE ON mus_track_video
FOR EACH ROW
BEGIN
  UPDATE mus_track_video SET updated_at = datetime('now') WHERE id = old.id;
END;
