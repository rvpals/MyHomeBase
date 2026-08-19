-- Music Library: catalog of audio files living on the NAS, plus playlists.
--
-- The audio itself is NEVER stored here. A track row holds metadata and a
-- path relative to MYHOMEBASE_MUSIC_ROOT; the bytes are streamed straight off
-- disk by the streaming route. The library measured 20,272 files at build time
-- (10,574 mp3 / 8,591 flac / 886 ape / 90 wma / 84 ogg / 25 m4a / 22 wav), so a
-- single album's worth of BLOBs would dwarf the entire rest of the database --
-- and better-sqlite3 is synchronous, so serving a 40 MB blob would block every
-- other page render.
--
-- Paths are stored RELATIVE to the configured root, never absolute. The root
-- differs per environment (`//NAS_DS223/MEDIA/AUDIO` from Windows in dev,
-- `/volume1/MEDIA/AUDIO` on the NAS itself), so an absolute path would make the
-- catalog non-portable between the two.
--
-- No DB-level foreign keys -- the repository maintains the links, per project
-- convention. Optional text fields store '' rather than NULL, matching att_* and
-- jrn_*.

-- One row per audio file found by a scan.
--
-- `relative_path` is the identity of a track: it is what the scanner rediscovers
-- on a re-scan and what the streaming route resolves back to a real file. UNIQUE,
-- because the same file cannot be two tracks.
--
-- `file_mtime` + `file_size` exist to make re-scanning cheap. A full scan opens
-- every file to read its tags, which over SMB in dev takes many minutes; a
-- re-scan compares these two values first and skips anything unchanged, so the
-- expensive walk happens once. They are the file's values, not ours -- never
-- update one without re-reading the tags.
--
-- `is_streamable` is denormalized from the extension deliberately. Browsers
-- cannot play APE (Monkey's Audio) or WMA at all -- there is no HTML5 support and
-- no prospect of it -- so 976 of the measured files can be catalogued but not
-- played. Storing the verdict lets a list query grey out the play button without
-- the reader re-deriving the format rules; `src/lib/music/formats.ts` is the one
-- place that decides it.
--
-- `has_cue_sheet` flags a single-file album: one FLAC/APE holding a whole CD with
-- a sibling .cue marking the track boundaries (398 of them here). Those are
-- catalogued as ONE track for now -- playing an individual track inside one means
-- seeking to a byte offset mid-file, which is a separate feature. The column
-- exists so that feature can find its candidates later without another scan.
CREATE TABLE mus_tracks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  relative_path     TEXT    NOT NULL,             -- from MYHOMEBASE_MUSIC_ROOT, '/' separated
  file_name         TEXT    NOT NULL,             -- basename, for filename-derived fallbacks
  title             TEXT    NOT NULL DEFAULT '',  -- '' when untagged; UI falls back to file_name
  artist            TEXT    NOT NULL DEFAULT '',
  album             TEXT    NOT NULL DEFAULT '',
  album_artist      TEXT    NOT NULL DEFAULT '',  -- compilations differ from `artist`
  genre             TEXT    NOT NULL DEFAULT '',
  release_year      INTEGER,                      -- NULL = unknown, not 0
  track_number      INTEGER,
  disc_number       INTEGER,
  duration_seconds  INTEGER,                      -- NULL when the tag reader could not tell
  extension         TEXT    NOT NULL,             -- lowercase, no dot: 'mp3', 'flac'
  mime_type         TEXT    NOT NULL,             -- what the streaming route serves
  file_size         INTEGER NOT NULL,
  file_mtime        TEXT    NOT NULL,             -- ISO 8601, from the filesystem
  is_streamable     INTEGER NOT NULL DEFAULT 1,   -- 0 = catalogued but unplayable (ape, wma)
  has_cue_sheet     INTEGER NOT NULL DEFAULT 0,
  album_id          INTEGER,                      -- -> mus_albums.id, NULL until grouped
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The scanner's upsert key, and the streaming route's lookup.
CREATE UNIQUE INDEX idx_mus_tracks_relative_path ON mus_tracks (relative_path);

-- Browse-by-artist and browse-by-album, the two commonest reads. NOCASE because
-- "beyond" and "Beyond" are one artist to a listener.
CREATE INDEX idx_mus_tracks_artist ON mus_tracks (artist COLLATE NOCASE, album COLLATE NOCASE, track_number);
CREATE INDEX idx_mus_tracks_album  ON mus_tracks (album_id, disc_number, track_number);

-- Search. 20k rows is far too many to list, so the library view is search-first
-- and needs this rather than a scan per keystroke.
CREATE INDEX idx_mus_tracks_title ON mus_tracks (title COLLATE NOCASE);

-- "What did the last scan of this folder find" -- the scan view lists by folder.
CREATE INDEX idx_mus_tracks_streamable ON mus_tracks (is_streamable);

CREATE TRIGGER mus_tracks_set_updated_at
AFTER UPDATE ON mus_tracks
FOR EACH ROW
BEGIN
  UPDATE mus_tracks SET updated_at = datetime('now') WHERE id = old.id;
END;

-- Albums, derived from track tags rather than declared by anyone.
--
-- Identity is (name, album_artist): two different artists may both have a "Greatest
-- Hits", and they are not one album. NOCASE for the same reason as above.
--
-- `cover_image` is the one BLOB in this module, and it carries the obligation
-- coding-guide.md sets out for per-row images: every ordinary read of this table
-- must use an explicit column list omitting it and expose only
-- `cover_image IS NOT NULL AS has_cover_image`. Album art is ~100 KB and there
-- are thousands of albums, so a SELECT * on a browse page would ship hundreds of
-- megabytes. Exactly one reader is allowed: the cover-serving route.
CREATE TABLE mus_albums (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  album_artist      TEXT    NOT NULL DEFAULT '',
  genre             TEXT    NOT NULL DEFAULT '',
  release_year      INTEGER,
  track_count       INTEGER NOT NULL DEFAULT 0,   -- maintained by the scanner
  cover_image       BLOB,
  cover_mime_type   TEXT    NOT NULL DEFAULT '',  -- '' when there is no image
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_mus_albums_identity ON mus_albums (name COLLATE NOCASE, album_artist COLLATE NOCASE);
CREATE INDEX        idx_mus_albums_artist   ON mus_albums (album_artist COLLATE NOCASE, name COLLATE NOCASE);

CREATE TRIGGER mus_albums_set_updated_at
AFTER UPDATE ON mus_albums
FOR EACH ROW
BEGIN
  UPDATE mus_albums SET updated_at = datetime('now') WHERE id = old.id;
END;

-- A scan run: what a scan looked at, and how it went.
--
-- This table is what makes a long scan usable, and it exists because of two hard
-- constraints. The NAS is a DS223 (2 GB RAM, quad Cortex-A55, swapping at idle --
-- see scripts/publish-nas.mjs), and reading tags on 20k files takes minutes to
-- tens of minutes there. So:
--
--   1. A scan CANNOT complete inside an HTTP request. The web action starts one
--      and returns immediately; the UI polls this row for progress. Keeping
--      progress in memory instead would lose it on a page refresh and would be
--      invisible to a scan started from the CLI.
--   2. The scan writes in batches and yields the event loop between them, so the
--      rest of the app stays responsive. A worker thread was considered and
--      rejected: it would need a third bundled entry point in publish-nas.mjs and
--      a worker path that resolves both under `next dev` and in the standalone
--      build, which is real deployment risk for a job that is expensive exactly
--      once. Because the use-case is a plain function behind ports, moving it into
--      a worker later changes how it is invoked, not what it does.
--
-- `root_folder` is the sub-folder that was scanned, relative to the music root
-- ('' meaning the whole library). Scanning a chosen sub-folder is the normal case:
-- the top level here mixes languages, genres, alphabet buckets and junk folders
-- ('NO MUSIC', 'unsort'), so "catalog this one folder" is both faster and the way
-- to exclude what you don't want -- no ignore-list setting needed.
--
-- A visible progress bar is why the scan runs in TWO phases. A percentage needs a
-- denominator, so a fast walk counts candidate files first -- reading directory
-- entries only, opening nothing -- and writes the total to `files_total`. The slow
-- tag-reading pass then fills `files_seen` and `current_path` as it goes, so the UI
-- can show both "62%" and the file being read right now. While `files_total` is 0
-- the counting phase is still running and the bar shows as indeterminate.

-- `formats_json` records the extension allowlist in force for the run, so a later
-- reader can tell whether a folder was scanned with a narrower filter than it
-- would be today. Stored as JSON because it is an opaque record of a past choice,
-- never queried by element.
--
-- `status` is 'running' | 'completed' | 'failed' | 'cancelled'. A row left
-- 'running' after a process restart is stale rather than active -- the reader
-- treats a running row with an old `updated_at` as interrupted, which is also
-- what makes a scan resumable: re-running it skips unchanged files by mtime.
CREATE TABLE mus_scan_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  root_folder       TEXT    NOT NULL DEFAULT '',  -- relative to the music root; '' = everything
  formats_json      TEXT    NOT NULL DEFAULT '[]',
  status            TEXT    NOT NULL DEFAULT 'running',
  files_total       INTEGER NOT NULL DEFAULT 0,   -- denominator for the progress bar; 0 = still counting
  files_seen        INTEGER NOT NULL DEFAULT 0,   -- candidates processed so far (the numerator)
  tracks_added      INTEGER NOT NULL DEFAULT 0,
  tracks_updated    INTEGER NOT NULL DEFAULT 0,
  files_skipped     INTEGER NOT NULL DEFAULT 0,   -- unchanged by mtime+size, or filtered out
  files_failed      INTEGER NOT NULL DEFAULT 0,   -- unreadable or tag-parse failure
  last_error        TEXT    NOT NULL DEFAULT '',  -- most recent failure, for the UI
  current_path      TEXT    NOT NULL DEFAULT '',  -- what it is working on right now
  started_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  finished_at       TEXT,                         -- NULL while running
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The scan view shows the newest run first, and polls the running one.
CREATE INDEX idx_mus_scan_runs_recent ON mus_scan_runs (started_at DESC);
CREATE INDEX idx_mus_scan_runs_status ON mus_scan_runs (status, started_at DESC);

-- NOTE: no updated_at trigger here on purpose. A scan updates its own progress
-- row thousands of times; the writer sets updated_at explicitly in the same
-- statement, and a trigger would double every one of those writes.
