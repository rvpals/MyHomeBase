-- Journal: the saved-location library behind the Location Manager section.
--
-- The library is the *source*; jrn_entry_locations stays the *copy*. Picking a
-- saved location writes its coordinates and name onto the entry as before and
-- records which library row they came from, so deleting a library row never
-- mutates an entry that already happened. See the .md log for why.
CREATE TABLE jrn_locations (
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

CREATE TRIGGER jrn_locations_set_updated_at
AFTER UPDATE ON jrn_locations
FOR EACH ROW
BEGIN
  UPDATE jrn_locations SET updated_at = datetime('now') WHERE id = old.id;
END;

-- Managed list of location categories. Keyed by name, exactly as jrn_categories
-- is, and for the same reason: the pairing rows carry the name, so a rename is a
-- deliberate act rather than something an id hides.
--
-- A separate list from jrn_categories on purpose. An entry's categories say what
-- the *writing* is about ("Travel", "Work"); a location's say what the *place*
-- is ("Restaurant", "Trailhead"). Sharing one list would put every entry
-- category in the location filter and back again.
CREATE TABLE jrn_location_categories (
  name        TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER jrn_location_categories_set_updated_at
AFTER UPDATE ON jrn_location_categories
FOR EACH ROW
BEGIN
  UPDATE jrn_location_categories SET updated_at = datetime('now') WHERE name = old.name;
END;

-- Managed list of location tags. Same shape as jrn_location_categories.
CREATE TABLE jrn_location_tags (
  name        TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER jrn_location_tags_set_updated_at
AFTER UPDATE ON jrn_location_tags
FOR EACH ROW
BEGIN
  UPDATE jrn_location_tags SET updated_at = datetime('now') WHERE name = old.name;
END;

-- Location <-> category pairings (many-to-many).
--
-- Unlike jrn_entry_categories these DO carry a foreign key, because both sides
-- are library rows this module owns outright: a location and its categories are
-- written in one transaction and there is no importer that creates a pairing
-- ahead of the thing it points at.
CREATE TABLE jrn_location_category_links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id   INTEGER NOT NULL REFERENCES jrn_locations(id) ON DELETE CASCADE,
  category_name TEXT    NOT NULL REFERENCES jrn_location_categories(name) ON UPDATE CASCADE,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_jrn_location_category_links_unique
  ON jrn_location_category_links (location_id, category_name);
CREATE INDEX idx_jrn_location_category_links_category
  ON jrn_location_category_links (category_name);

-- Location <-> tag pairings. Same shape as the category links above.
CREATE TABLE jrn_location_tag_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id INTEGER NOT NULL REFERENCES jrn_locations(id) ON DELETE CASCADE,
  tag_name    TEXT    NOT NULL REFERENCES jrn_location_tags(name) ON UPDATE CASCADE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_jrn_location_tag_links_unique
  ON jrn_location_tag_links (location_id, tag_name);
CREATE INDEX idx_jrn_location_tag_links_tag
  ON jrn_location_tag_links (tag_name);

-- Which library row an entry's location was picked from, or NULL when the point
-- was dropped on the map by hand (every row that existed before this migration).
--
-- ON DELETE SET NULL, emphatically not CASCADE: retiring a place from the
-- library must never delete a location off an entry that already happened. The
-- entry keeps its coordinates and its name; it just stops pointing anywhere.
ALTER TABLE jrn_entry_locations
  ADD COLUMN saved_location_id INTEGER REFERENCES jrn_locations(id) ON DELETE SET NULL;

-- Answers "how many entries use this place?", which the manager shows on every
-- row and checks before a delete.
CREATE INDEX idx_jrn_entry_locations_saved_location_id
  ON jrn_entry_locations (saved_location_id);
