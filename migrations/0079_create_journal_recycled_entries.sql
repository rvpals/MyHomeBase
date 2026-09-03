-- A recycle bin for journal entries, plus the removal of a dead table.
--
-- The Correct tab of Journal → Data Management finds duplicate entries (same
-- date + same title) and lets you delete the ones you don't want. "Delete"
-- there means "move to the recycle bin", so a mis-checked box is recoverable.
--
-- An entry is NOT one row: its categories, tags and locations live in child
-- tables. A bin that only copied jrn_entries would restore an entry stripped of
-- its taxonomy — silent data loss wearing a safety feature's clothes. So all
-- four tables get a mirror with the same columns.

-- One row per recycled entry. Mirrors jrn_entries column for column, with two
-- additions and one change:
--
--   * `id` is this table's own surrogate key, because the same original entry
--     can be recycled, restored, and recycled again.
--   * `entry_id` remembers the id the entry had in jrn_entries. Restore aims to
--     put it back at that id; if something else has taken it meanwhile, the
--     restore takes a fresh id instead (see recycle.ts).
--   * `deleted_at` is when it went into the bin — the sort order of the list.
--
-- is_locked is carried across deliberately: a locked entry can be recycled (the
-- bin makes that safe), and it must come back locked, or the restore would
-- quietly strip a protection the user set.
CREATE TABLE jrn_recycled_entries (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id            INTEGER NOT NULL,               -- the id it had in jrn_entries
  entry_date          TEXT    NOT NULL,               -- YYYY-MM-DD
  entry_time          TEXT    NOT NULL DEFAULT '',    -- HH:MM
  title               TEXT    NOT NULL DEFAULT '',
  content             TEXT    NOT NULL DEFAULT '',
  place_name          TEXT    NOT NULL DEFAULT '',
  weather_temp        REAL,
  weather_unit        TEXT,
  weather_description TEXT,
  weather_code        INTEGER,
  is_pinned           INTEGER NOT NULL DEFAULT 0,
  is_locked           INTEGER NOT NULL DEFAULT 0,
  -- The original timestamps, preserved. A restored entry should claim the date
  -- it was written, not the date it came out of the bin.
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  deleted_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The list is "newest deleted first", which is what this index serves.
CREATE INDEX idx_jrn_recycled_entries_deleted_at ON jrn_recycled_entries (deleted_at);
CREATE INDEX idx_jrn_recycled_entries_entry_id   ON jrn_recycled_entries (entry_id);

-- No updated_at trigger, unlike jrn_entries. A row in the bin is immutable: it
-- is inserted on delete and removed on restore or purge, never edited. A
-- trigger here would overwrite the original updated_at the restore depends on.

-- Child mirrors. recycled_entry_id points at jrn_recycled_entries.id, NOT at
-- the original entry id — the bin is self-contained, so a purge only has to
-- follow this one key. No DB-level foreign keys, same as the rest of the module:
-- the repository deletes children in the same transaction as the parent.
CREATE TABLE jrn_recycled_entry_categories (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  recycled_entry_id  INTEGER NOT NULL,
  category_name      TEXT    NOT NULL,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_jrn_recycled_entry_categories_parent
  ON jrn_recycled_entry_categories (recycled_entry_id);

CREATE TABLE jrn_recycled_entry_tags (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  recycled_entry_id  INTEGER NOT NULL,
  tag_name           TEXT    NOT NULL,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_jrn_recycled_entry_tags_parent
  ON jrn_recycled_entry_tags (recycled_entry_id);

CREATE TABLE jrn_recycled_entry_locations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  recycled_entry_id  INTEGER NOT NULL,
  latitude           REAL    NOT NULL,
  longitude          REAL    NOT NULL,
  location_name      TEXT    NOT NULL DEFAULT '',
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_jrn_recycled_entry_locations_parent
  ON jrn_recycled_entry_locations (recycled_entry_id);

-- Drop a table nothing reads.
--
-- jrn_entry_images was created by 0027 as part of the port from the standalone
-- journal app, which stored attachments as inline base64 data URLs. MyHomeBase
-- never wired it up: journal photos come off the filesystem instead
-- (journal-photo-root.ts), and a repo-wide search finds no reader, no writer,
-- and no migration touching it since 0027 — only a descriptive line in the SQL
-- Explorer's table reference, removed in the same change as this migration.
--
-- Confirmed empty in practice; the DROP discards any rows regardless, which is
-- the accepted outcome for a table the running app cannot produce data in.
DROP TABLE IF EXISTS jrn_entry_images;
