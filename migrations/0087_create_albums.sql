-- Photo albums for the Picture Gallery module: named, ordered collections of paths
-- into the photo archive. See 0087_create_albums.md for the reasoning.

CREATE TABLE pho_albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- COLLATE NOCASE so "Croatia" and "croatia" collide. Two albums a reader cannot tell
-- apart in a nav list are two albums they will open the wrong one of. The use-case
-- checks this first to produce a readable message; this index is what makes the answer
-- true under a race between two tabs.
CREATE UNIQUE INDEX idx_albums_name ON pho_albums (name COLLATE NOCASE);

CREATE TABLE pho_album_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL REFERENCES pho_albums (id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A photo appears at most once in a given album. Both columns identify the row
-- exactly, which is what coding-guide.md requires of a unique index -- and note there
-- is deliberately NO date column in it, the trap that cost stk_stock_transactions real
-- data.
CREATE UNIQUE INDEX idx_album_photos_unique
  ON pho_album_photos (album_id, relative_path);

-- The album's own sequence, which is how every read of an album is ordered.
CREATE INDEX idx_album_photos_order ON pho_album_photos (album_id, sort_order);

-- Lookups the other way: "which albums hold this photograph", for the single-photo
-- viewer's + menu. Without this, ticking the menu open is a full scan of every
-- membership row in the database.
CREATE INDEX idx_album_photos_path ON pho_album_photos (relative_path);
