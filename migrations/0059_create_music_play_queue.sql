-- Music Library: the play queue, made visible and made to survive a reload.
--
-- The queue already existed before this migration -- as React state in
-- MusicPlayerProvider, set whenever you clicked a track in a list. It had two
-- problems: nothing rendered it, and it died with the page. This table fixes the
-- second; the Queue section fixes the first.
--
-- ONE ROW PER QUEUE ENTRY, plus a single-row state table for the playback modes.

-- The queue's entries, in order.
--
-- `position` is an explicit integer, exactly as in mus_playlist_tracks (0056), and for
-- the same reason: a queue is reorderable and rowid order cannot express a move. It is
-- deliberately NOT unique per queue -- a shuffle rewrites every row at once, and a
-- unique index would reject the intermediate states of that rewrite.
--
-- The same track MAY appear twice. That is not a tolerated edge case but the normal
-- one: queueing an album twice, or a magic playlist that legitimately repeats, must
-- not silently collapse to one entry. So no unique constraint on track_id.
CREATE TABLE mus_play_queue (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id   INTEGER NOT NULL,  -- -> mus_tracks.id
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Reading the queue is always "every entry in order". Ties break on id, which is
-- stable, so two rows left on the same position never swap between reads.
CREATE INDEX idx_mus_play_queue_order ON mus_play_queue (position, id);

-- "Is this track queued", and the cleanup path when a scan finds a file has vanished
-- from disk -- the same job idx_mus_playlist_tracks_track does for playlists.
CREATE INDEX idx_mus_play_queue_track ON mus_play_queue (track_id);

-- The queue's playback state: what is playing, and how to advance.
--
-- A single-row table (`id` pinned to 1 by a CHECK) rather than four rows in
-- sys_app_settings. Both would work; this is chosen because these four values are one
-- fact that is read and written together on every track change, and because
-- sys_app_settings.value is TEXT -- storing repeat_mode there is fine, but storing
-- `current_entry_id` as text that every reader must parse back to an integer is the
-- kind of stringly-typed state that goes wrong quietly.
--
-- The CHECK is what makes "single row" a guarantee rather than a convention: an INSERT
-- of a second row fails loudly instead of leaving two candidate states and a reader
-- picking whichever it saw first.
CREATE TABLE mus_play_queue_state (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  -- Which ENTRY is current, not which track -- the queue may hold a track twice, and
  -- "the second copy of this song" is a position a listener can genuinely be at.
  -- Nullable: a queue with nothing playing is a real state (loaded but not started).
  current_entry_id INTEGER,
  -- 'off' | 'all' | 'one'. Text rather than an integer enum so the stored value is
  -- readable in a SQL client; the CHECK is what keeps it honest, since SQLite has no
  -- enum type and would otherwise accept any string at all.
  repeat_mode      TEXT    NOT NULL DEFAULT 'off'
                     CHECK (repeat_mode IN ('off', 'all', 'one')),
  -- Whether the visible order has been shuffled. Stored as a flag rather than inferred,
  -- because after a shuffle the rows ARE the new order -- there is nothing left in the
  -- data to compare against to detect it. The UI needs it to light the button.
  is_shuffled      INTEGER NOT NULL DEFAULT 0,
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The single row, seeded here so every read path can assume it exists and no caller
-- needs an "insert if missing" dance before an UPDATE.
INSERT INTO mus_play_queue_state (id, current_entry_id, repeat_mode, is_shuffled)
VALUES (1, NULL, 'off', 0);

CREATE TRIGGER mus_play_queue_state_set_updated_at
AFTER UPDATE ON mus_play_queue_state
FOR EACH ROW
BEGIN
  UPDATE mus_play_queue_state SET updated_at = datetime('now') WHERE id = old.id;
END;
