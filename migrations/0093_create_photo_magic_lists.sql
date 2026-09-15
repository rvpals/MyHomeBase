-- Picture Gallery: Magic Lists -- saved search criteria over the photo archive, the
-- set each last generated, and the file-facts index that makes the search affordable.
--
-- A Magic List is a QUERY, not a hand-built collection. The reader picks a date range,
-- a file-size band, a minimum resolution and a ceiling on how many pictures they want;
-- the generator draws at random from everything in the archive that matches.
-- `pho_albums` (0087) already covers "a collection I assembled by hand" -- this is the
-- other thing, and they are separate tables for the same reason `mus_magic_list` and
-- `mus_playlists` are: an album has no criteria, and a magic list's photo order is
-- disposable. One table would have half its columns meaningless for either kind of row.
--
-- No DB-level foreign keys -- the repository maintains the links, per project convention.

-- ---------------------------------------------------------------------------------
-- One saved set of criteria.
-- ---------------------------------------------------------------------------------
--
-- WHY SCALAR COLUMNS AND NOT A `criteria_json` BLOB. `mus_magic_list` (0057) stores its
-- genres, artists and album ids as JSON arrays, and that was right there: each is a
-- LIST, read and written whole, and normalising them would have bought three joins for
-- a query nothing asks. Every criterion here is a single scalar instead, and -- the
-- deciding difference -- they are what `pho_photo_index` is actually QUERIED BY. A date
-- range and a size band in real columns let the index below do the filtering in SQL; the
-- same values inside a JSON string would force every indexed row to be read and parsed
-- in JS to answer "which photos match". Same module, opposite call, because the data is
-- shaped the other way round.
--
-- Every bound is NULLABLE, and NULL means "no restriction on this end" rather than zero
-- or infinity. That distinction is the whole semantics of the form -- a list with no
-- minimum size must not be a list that matches nothing -- and it is enforced in one
-- place (`matchesCriteria`), never re-derived by a caller.
CREATE TABLE pho_magic_list (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  description       TEXT    NOT NULL DEFAULT '',

  -- The date range, inclusive, as `YYYY-MM-DD`. Matched against a photo's capture date
  -- (`pho_photo_index.taken_at_date`), NOT its file mtime: a copied or re-filed archive
  -- has mtimes from the day it was copied, which would make every range meaningless.
  from_date         TEXT,
  to_date           TEXT,

  -- File size in BYTES, not KB or MB. The unit the filesystem reports and the unit the
  -- index stores, so there is no conversion anywhere that could round a boundary the
  -- wrong way; the form does the humanising.
  min_bytes         INTEGER,
  max_bytes         INTEGER,

  -- Resolution as separate width and height minimums rather than a megapixel count.
  -- "At least 1920x1080" is what a slideshow or wallpaper criterion actually means, and
  -- a megapixel figure cannot express it -- a 3000x700 panorama and a 1450x1450 square
  -- are the same 2.1MP and only one of them fills a screen. Maximums are here for the
  -- opposite want ("nothing enormous"), and are the less-used half of the pair.
  min_width         INTEGER,
  min_height        INTEGER,
  max_width         INTEGER,
  max_height        INTEGER,

  -- The ceiling on how many photographs to draw. NOT NULL: unlike every other criterion
  -- above, "no limit" is not a sensible answer here -- a range covering a decade would
  -- return tens of thousands of paths and the screen would try to thumbnail all of them.
  -- The schema clamps it; this default matches the form's.
  max_photos        INTEGER NOT NULL DEFAULT 100,

  -- NULL until the list has been generated once. Distinguishes "saved but never rolled"
  -- from "generated", which the view needs to decide between an empty state and a grid.
  last_generated_at TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One magic list per name, matching `idx_albums_name` and `idx_mus_magic_list_name`.
-- NOCASE for the same reason: "Summer 2019" and "summer 2019" are one list to a reader,
-- and saving the second should be told it already exists rather than silently twinned.
CREATE UNIQUE INDEX idx_pho_magic_list_name ON pho_magic_list (name COLLATE NOCASE);

CREATE TRIGGER pho_magic_list_set_updated_at
AFTER UPDATE ON pho_magic_list
FOR EACH ROW
BEGIN
  UPDATE pho_magic_list SET updated_at = datetime('now') WHERE id = old.id;
END;

-- ---------------------------------------------------------------------------------
-- The photographs a list generated, in order.
-- ---------------------------------------------------------------------------------
--
-- WHY THESE ARE STORED AT ALL, given the criteria could regenerate them. Because
-- "roll me a new set" and "show me the set I saved" are different wants, and keeping
-- only the criteria satisfies the first at the cost of the second: every load would
-- reshuffle, so a set the reader liked could never be returned to. Storing the draw
-- makes loading REPLAY it, and "Create the list" the explicit way to re-roll. Straight
-- from `mus_magic_list_tracks` (0057), which argued exactly this.
--
-- Rebuilt WHOLESALE on each generate -- delete every row for the list, insert the new
-- draw -- rather than diffed. A re-roll has no relationship to what came before, so
-- there is no meaningful diff and a delete-insert in one transaction is both simpler
-- and correct.
--
-- Stores `relative_path`, not an id into `pho_photo_index`. The index is a CACHE and is
-- prunable; a generated set is what the reader kept. Pointing at the path means clearing
-- and rebuilding the index cannot empty somebody's saved list, and it matches how
-- `pho_album_photos` and `sys_fav_photo` both address a photograph.
CREATE TABLE pho_magic_list_photos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  magic_list_id INTEGER NOT NULL,               -- -> pho_magic_list.id
  relative_path TEXT    NOT NULL,
  -- Explicit, like `pho_album_photos.sort_order`, and NOT unique per list: a
  -- delete-insert rebuild would fight a unique index across its intermediate states.
  -- Ties break on id, which is stable.
  position      INTEGER NOT NULL DEFAULT 0
);

-- Reading a generated set is always "its photos in order".
CREATE INDEX idx_pho_magic_list_photos_order
  ON pho_magic_list_photos (magic_list_id, position, id);

-- ---------------------------------------------------------------------------------
-- The file-facts index: what a scan learned about each photograph.
-- ---------------------------------------------------------------------------------
--
-- WHY THIS TABLE EXISTS AT ALL, and why it is here rather than beside the photographs.
-- `src/lib/journal-photos/ports.ts` states the archive's standing rule: nothing is ever
-- written INTO a photo folder -- not a thumbnail, not an index, not a sidecar -- and it
-- names the precondition for a cache like this one, that it "should live outside the
-- archive anyway" and needs "a separate, explicitly named port and a migration-log entry
-- justifying it". This is that table and 0093's .md is that entry. The archive stays
-- read-only; the database records what was observed about it.
--
-- WHY IT IS NEEDED. Size and resolution are not in any directory listing. Answering
-- "photos over 4MB at 1920x1080 or better" without a cache means, on every single run,
-- a `stat` plus a 128KB header read for every file in the range -- thousands of
-- round-trips over SMB to a DS223. With it, the first scan of a range pays that once and
-- every later run is a SQL query. This is the `mus_tracks` pattern (0052), which caches
-- `duration_seconds` for identical reasons.
--
-- WHAT IT IS NOT: a list of photographs. It is a cache OF FACTS about files, keyed by
-- path, safe to delete and rebuild at any time. Nothing the reader created lives here --
-- that is `pho_magic_list`, `pho_albums` and `sys_fav_photo`, none of which reference it.
CREATE TABLE pho_photo_index (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Path from the photo root, '/' separated -- the same key `sys_fav_photo`,
  -- `pho_album_photos` and the image route all use.
  relative_path TEXT    NOT NULL,

  -- The two facts the criteria filter on.
  bytes         INTEGER NOT NULL,
  -- NULL when the JPEG's dimensions could not be read (a truncated file, or a variant
  -- the SOF parser does not recognise). NULL is "unknown", and a resolution criterion
  -- EXCLUDES an unknown rather than guessing -- the same call `mus_tracks` makes for a
  -- track with no `duration_seconds`, which cannot be counted toward a time target.
  width         INTEGER,
  height        INTEGER,

  -- The capture date, `YYYY-MM-DD`, and where it came from -- 'exif', 'file-name',
  -- 'folder' or 'none', matching `PhotoDateSource`. The source is stored, not just the
  -- date, so the index can stay HONEST about a date inferred from a filename versus one
  -- the camera recorded, exactly as `PhotoDetails` does for a single photo.
  taken_at_date   TEXT,
  taken_at_source TEXT NOT NULL DEFAULT 'none',

  -- The skip check. Same size and same mtime means the file has not changed, so the
  -- cached row stands and neither the `stat` nor the header read is repeated. Lifted
  -- from `mus_tracks.file_size` + `file_mtime`, whose scan comments call this "the cheap
  -- skip that makes a re-scan take seconds instead of minutes".
  file_mtime    TEXT    NOT NULL,   -- ISO 8601, from the filesystem
  indexed_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Identity. One row per photograph, and the lookup the skip check runs per file.
-- Case-SENSITIVE, deliberately, matching `sys_fav_photo`'s primary key (0073): these
-- paths come off a Linux NAS where two names differing only in case are two files.
CREATE UNIQUE INDEX idx_pho_photo_index_path ON pho_photo_index (relative_path);

-- The generator's candidate query: a date range, narrowed by size. Covering in the
-- order the WHERE clause is written, so the common search is an index scan rather than
-- a table scan. Partial -- a row with no capture date can never satisfy a date range,
-- and every Magic List has one -- which keeps the index the size of the answer rather
-- than the size of the archive. Same reasoning as `idx_mus_tracks_magic_candidates`.
CREATE INDEX idx_pho_photo_index_candidates
  ON pho_photo_index (taken_at_date, bytes, id)
  WHERE taken_at_date IS NOT NULL;

-- ---------------------------------------------------------------------------------
-- Scan progress: one row per run of the indexer.
-- ---------------------------------------------------------------------------------
--
-- A TABLE RATHER THAN AN IN-MEMORY COUNTER, for the reasons `mus_scan_runs` (0052)
-- gives: progress held in a module variable is lost on a page refresh, invisible to a
-- scan started from the CLI, and gone entirely if the process restarts mid-run. A row
-- is what lets the view poll "how far along is it" without holding the request open.
--
-- `files_total` is 0 while the counting phase is still walking, which the bar renders as
-- INDETERMINATE rather than as 0% -- see `scanProgressPercent`.
--
-- NOTE: no `updated_at` trigger, unlike `pho_magic_list` above. This row is written
-- every 25 files for the length of a scan, and a trigger firing on each of those writes
-- is pure overhead; the writer sets the column explicitly. `mus_scan_runs` made and
-- documented the same exception.
CREATE TABLE pho_magic_scan_run (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The range being indexed, echoed back so a stale or concurrent run can say what it
  -- was working on. '' for a run with no date bound.
  from_date     TEXT    NOT NULL DEFAULT '',
  to_date       TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'running',  -- running|completed|failed|cancelled
  files_total   INTEGER NOT NULL DEFAULT 0,          -- denominator; 0 = still counting
  files_seen    INTEGER NOT NULL DEFAULT 0,          -- numerator
  files_indexed INTEGER NOT NULL DEFAULT 0,          -- read from disk and written
  files_cached  INTEGER NOT NULL DEFAULT 0,          -- unchanged, skipped by the mtime check
  files_failed  INTEGER NOT NULL DEFAULT 0,
  current_path  TEXT    NOT NULL DEFAULT '',
  last_error    TEXT    NOT NULL DEFAULT '',
  started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  finished_at   TEXT,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- "Is one running now?" (the guard that stops two scans racing) and "show me recent
-- runs". Both are the same two shapes `mus_scan_runs` indexes for.
CREATE INDEX idx_pho_magic_scan_run_status ON pho_magic_scan_run (status, started_at DESC);
CREATE INDEX idx_pho_magic_scan_run_recent ON pho_magic_scan_run (started_at DESC);
