-- Retires the Journal's saved-location library. The application-wide
-- sys_locations family (migration 0140) replaces it.
--
-- The taxonomy was already copied across by 0140, icons and all. The places
-- themselves are NOT copied and are lost here: the reader is recreating them by
-- hand, which is why 0140 left sys_locations empty.
--
-- Order matters. The link tables carry foreign keys into jrn_locations and the
-- two taxonomy tables, so they go first; dropping a parent first would leave
-- the children referencing a table that no longer exists.
DROP TABLE IF EXISTS jrn_location_category_links;
DROP TABLE IF EXISTS jrn_location_tag_links;
DROP TABLE IF EXISTS jrn_locations;
DROP TABLE IF EXISTS jrn_location_categories;
DROP TABLE IF EXISTS jrn_location_tags;

-- Drop jrn_entry_locations.saved_location_id by rebuilding the table.
--
-- Not `ALTER TABLE ... DROP COLUMN`: the column is named by an index, which
-- older SQLite refuses to drop out from under, and a rebuild is the form that
-- works on every version this app has shipped against.
--
-- The entry's own copy of the point survives untouched -- latitude, longitude,
-- location_name, street_address, sort_order. Only the provenance pointer goes,
-- and with jrn_locations dropped it could not point anywhere anyway.
DROP INDEX IF EXISTS idx_jrn_entry_locations_saved_location_id;
DROP INDEX IF EXISTS idx_jrn_entry_locations_entry_id;

CREATE TABLE jrn_entry_locations_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id       INTEGER NOT NULL,
  latitude       REAL    NOT NULL,
  longitude      REAL    NOT NULL,
  location_name  TEXT    NOT NULL DEFAULT '',   -- optional, e.g. "pizza hut"
  -- Migration 0139. NULL for every row written before it, and for any pin added
  -- without an address lookup.
  street_address TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO jrn_entry_locations_new
  (id, entry_id, latitude, longitude, location_name, street_address, sort_order, created_at)
SELECT id, entry_id, latitude, longitude, location_name, street_address, sort_order, created_at
FROM jrn_entry_locations;

DROP TABLE jrn_entry_locations;

ALTER TABLE jrn_entry_locations_new RENAME TO jrn_entry_locations;

CREATE INDEX idx_jrn_entry_locations_entry_id
  ON jrn_entry_locations (entry_id);
