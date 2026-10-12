-- The application-wide saved-location library, behind Admin -> Locations.
--
-- Same shape as the journal's jrn_locations family (migration 0101, widened by
-- 0105), but owned by the application rather than by one module: the places a
-- reader saves are not a journal concept, and a second module wanting them
-- should not have to reach into jrn_ tables.
--
-- The jrn_location* tables stay in place and untouched here. They are phased
-- out in a later migration, once the screens that read them are gone.
CREATE TABLE sys_locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The short label the reader picks this place by, e.g. "Grandma's house".
  -- Not unique: two places may legitimately share a name, and the coordinates
  -- are what make them different. Blank is allowed -- an address-only row is
  -- still findable, and the manager shows the coordinates when there is no name.
  name        TEXT NOT NULL DEFAULT '',
  latitude    REAL NOT NULL,
  longitude   REAL NOT NULL,
  -- The reader's own words about the place. Searched alongside address.
  description TEXT NOT NULL DEFAULT '',
  -- The postal address, usually filled by reverse-geocoding the pin but always
  -- editable -- Nominatim's answer for a rural point is often a road, not a
  -- house. Searched alongside description.
  address     TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER sys_locations_set_updated_at
AFTER UPDATE ON sys_locations
FOR EACH ROW
BEGIN
  UPDATE sys_locations SET updated_at = datetime('now') WHERE id = old.id;
END;

-- Managed list of location categories. Keyed by name, exactly as its jrn_
-- predecessor was, and for the same reason: the pairing rows carry the name, so
-- a rename is a deliberate act rather than something an id hides.
--
-- The two icon columns are declared here rather than added by a later
-- migration, because this table is new: 0101-then-0105 was a history, not a
-- shape worth replaying. Both are nullable -- "no icon" is a real state, and an
-- empty blob is not a sensible stand-in for it. Reads of this list must select
-- columns explicitly so the blob is not pulled on every page load.
CREATE TABLE sys_location_categories (
  name                 TEXT PRIMARY KEY,
  description          TEXT NOT NULL DEFAULT '',
  icon_image           BLOB,
  icon_image_mime_type TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER sys_location_categories_set_updated_at
AFTER UPDATE ON sys_location_categories
FOR EACH ROW
BEGIN
  UPDATE sys_location_categories SET updated_at = datetime('now') WHERE name = old.name;
END;

-- Managed list of location tags. Same shape as sys_location_categories.
CREATE TABLE sys_location_tags (
  name                 TEXT PRIMARY KEY,
  description          TEXT NOT NULL DEFAULT '',
  icon_image           BLOB,
  icon_image_mime_type TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER sys_location_tags_set_updated_at
AFTER UPDATE ON sys_location_tags
FOR EACH ROW
BEGIN
  UPDATE sys_location_tags SET updated_at = datetime('now') WHERE name = old.name;
END;

-- Location <-> category pairings (many-to-many). Both sides are library rows
-- this table owns outright, so unlike the entry pairings these carry real
-- foreign keys.
CREATE TABLE sys_location_category_links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id   INTEGER NOT NULL REFERENCES sys_locations(id) ON DELETE CASCADE,
  category_name TEXT    NOT NULL REFERENCES sys_location_categories(name) ON UPDATE CASCADE,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_sys_location_category_links_unique
  ON sys_location_category_links (location_id, category_name);
CREATE INDEX idx_sys_location_category_links_category
  ON sys_location_category_links (category_name);

-- Location <-> tag pairings. Same shape as the category links above.
CREATE TABLE sys_location_tag_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id INTEGER NOT NULL REFERENCES sys_locations(id) ON DELETE CASCADE,
  tag_name    TEXT    NOT NULL REFERENCES sys_location_tags(name) ON UPDATE CASCADE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_sys_location_tag_links_unique
  ON sys_location_tag_links (location_id, tag_name);
CREATE INDEX idx_sys_location_tag_links_tag
  ON sys_location_tag_links (tag_name);

-- Carry the taxonomy across, icons and all. The places themselves are NOT
-- copied: the reader is recreating those by hand, and an empty sys_locations is
-- the intended starting state. No pairing rows either -- they point at location
-- ids that do not exist here.
--
-- Original created_at values come across, so a migrated name keeps the date it
-- was really introduced rather than claiming to be new today.
INSERT INTO sys_location_categories
  (name, description, icon_image, icon_image_mime_type, created_at, updated_at)
SELECT name, description, icon_image, icon_image_mime_type, created_at, updated_at
FROM jrn_location_categories;

INSERT INTO sys_location_tags
  (name, description, icon_image, icon_image_mime_type, created_at, updated_at)
SELECT name, description, icon_image, icon_image_mime_type, created_at, updated_at
FROM jrn_location_tags;
