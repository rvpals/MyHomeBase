-- Favourite photographs: one row per starred picture, for the home screen's random
-- photo card.
--
-- The card draws a photo at random and the reader has exactly one chance to keep it
-- before the next draw replaces it. That is the whole feature: a heart on the card's
-- title bar, and a list to read back what was kept.
--
-- `relative_path` is the primary key -- the path from the configured photo root, e.g.
-- `2019/2019-06 June/IMG_20190609_143501.jpg`, NOT an absolute one. The photo root is
-- a per-install SETTING (the Journal module's `photo_root`, falling back to
-- MYHOMEBASE_PHOTO_ROOT), so an absolute path would turn every favourite into a dead
-- link the day the share is remounted or the setting is corrected. The relative path
-- is also exactly what `photoRelativePathSchema` validates and what
-- /api/journal/photos serves, so a favourite needs no translation to be displayed.
--
-- No surrogate id, for the same reason as `stk_ticker_favorites` (0058): a favourite
-- has no identity of its own, the path IS the row, and keying on it makes the toggle
-- an INSERT/DELETE against a known key instead of a select-then-write. It also rules
-- out the "same photo favourited twice" bug class outright rather than guarding it
-- with a separate unique index.
--
-- Case-SENSITIVE, unlike the ticker table's COLLATE NOCASE. These keys are filesystem
-- paths and the archive lives on a Linux NAS, where `IMG_1.JPG` and `img_1.jpg` are
-- two different files. Folding case here would let one favourite shadow the other.
CREATE TABLE sys_fav_photo (
  relative_path TEXT PRIMARY KEY,
  -- Why this one was kept. Empty rather than NULL when unwritten: the list renders it
  -- as a cell either way, and NOT NULL means no reader has to handle two kinds of
  -- "no note". The note is edited in the favourites list, not at the moment of
  -- starring -- see 0073's log for why the heart does not prompt.
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Favourites are listed newest-first: the one just kept is the one being looked at.
CREATE INDEX idx_sys_fav_photo_created_at
  ON sys_fav_photo (created_at DESC);
