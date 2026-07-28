-- Journal (MyJournal) module core tables. Ported from a standalone SQLCipher
-- journal app and adapted to MyHomeBase conventions: jrn_ prefix, snake_case
-- columns, INTEGER surrogate keys, created_at/updated_at + triggers, no DB-level
-- foreign keys (cascade deletes are handled in the repository). The source app's
-- JSON array columns (categories, tags, locations) are normalized into their own
-- tables so the CSV importer can split "tag1, tag2" into rows and so widgets and
-- the SQL Explorer can JOIN/filter on them. Weather (1:1) is flattened to columns.

-- One row per journal entry. Multiple entries per calendar date are allowed:
-- entry_date is only indexed, never unique; each entry has its own id and time.
CREATE TABLE jrn_entries (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date          TEXT    NOT NULL,               -- YYYY-MM-DD
  entry_time          TEXT    NOT NULL DEFAULT '',     -- HH:MM
  title               TEXT    NOT NULL DEFAULT '',
  content             TEXT    NOT NULL DEFAULT '',
  place_name          TEXT    NOT NULL DEFAULT '',     -- free-text place, e.g. "NYC Trip"
  weather_temp        REAL,                            -- nullable: entry may have no weather
  weather_unit        TEXT,
  weather_description TEXT,
  weather_code        INTEGER,
  is_pinned           INTEGER NOT NULL DEFAULT 0,       -- 1 = pinned to dashboard
  is_locked           INTEGER NOT NULL DEFAULT 0,       -- 1 = editing disabled
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_jrn_entries_entry_date ON jrn_entries (entry_date);
CREATE INDEX idx_jrn_entries_is_pinned  ON jrn_entries (is_pinned);

CREATE TRIGGER jrn_entries_set_updated_at
AFTER UPDATE ON jrn_entries
FOR EACH ROW
BEGIN
  UPDATE jrn_entries SET updated_at = datetime('now') WHERE id = old.id;
END;

-- Managed list of categories. Keyed by name (the identity referenced from
-- jrn_entry_categories), same natural-key precedent as stk_stock_positions.ticker.
CREATE TABLE jrn_categories (
  name        TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER jrn_categories_set_updated_at
AFTER UPDATE ON jrn_categories
FOR EACH ROW
BEGIN
  UPDATE jrn_categories SET updated_at = datetime('now') WHERE name = old.name;
END;

-- Managed list of tags. Tags may also be created inline when writing an entry.
CREATE TABLE jrn_tags (
  name        TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER jrn_tags_set_updated_at
AFTER UPDATE ON jrn_tags
FOR EACH ROW
BEGIN
  UPDATE jrn_tags SET updated_at = datetime('now') WHERE name = old.name;
END;

-- Entry <-> category pairings (many-to-many). No FK: the repository deletes an
-- entry's pairings in the same transaction as the entry. category_name references
-- jrn_categories.name logically (import may also create the category on the fly).
CREATE TABLE jrn_entry_categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id      INTEGER NOT NULL,
  category_name TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_jrn_entry_categories_unique
  ON jrn_entry_categories (entry_id, category_name);
CREATE INDEX idx_jrn_entry_categories_entry_id
  ON jrn_entry_categories (entry_id);

-- Entry <-> tag pairings (many-to-many). Same shape as jrn_entry_categories.
CREATE TABLE jrn_entry_tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id   INTEGER NOT NULL,
  tag_name   TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_jrn_entry_tags_unique
  ON jrn_entry_tags (entry_id, tag_name);
CREATE INDEX idx_jrn_entry_tags_entry_id
  ON jrn_entry_tags (entry_id);

-- GPS coordinates for an entry, with an optional human-readable name. The CSV
-- importer parses "12234.44, -2334.333, pizza hut" into one row here.
CREATE TABLE jrn_entry_locations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id      INTEGER NOT NULL,
  latitude      REAL    NOT NULL,
  longitude     REAL    NOT NULL,
  location_name TEXT    NOT NULL DEFAULT '',   -- optional, e.g. "pizza hut"
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_jrn_entry_locations_entry_id
  ON jrn_entry_locations (entry_id);

-- Image attachments stored inline as base64 data URLs (full + thumbnail).
CREATE TABLE jrn_entry_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id   INTEGER NOT NULL,
  name       TEXT    NOT NULL DEFAULT '',   -- original filename
  data       TEXT    NOT NULL,               -- full image as base64 data URL
  thumbnail  TEXT    NOT NULL DEFAULT '',    -- thumbnail as base64 data URL
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_jrn_entry_images_entry_id
  ON jrn_entry_images (entry_id);

-- Custom PNG icons for categories and tags. icon_type distinguishes the standard
-- (64x64) and HD (128x128) variants: 'category', 'tag', 'category_hd', 'tag_hd'.
CREATE TABLE jrn_icons (
  icon_type  TEXT NOT NULL,                   -- category | tag | category_hd | tag_hd
  name       TEXT NOT NULL,                   -- the category/tag name this icon belongs to
  data       TEXT NOT NULL,                   -- PNG as data URL
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (icon_type, name)
);

CREATE TRIGGER jrn_icons_set_updated_at
AFTER UPDATE ON jrn_icons
FOR EACH ROW
BEGIN
  UPDATE jrn_icons SET updated_at = datetime('now')
  WHERE icon_type = old.icon_type AND name = old.name;
END;
