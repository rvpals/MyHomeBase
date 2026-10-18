-- Links an entry's pin back to the saved place it was copied from.
--
-- The entry keeps its full copy -- latitude, longitude, location_name,
-- street_address -- exactly as before. This adds a pointer *alongside* that
-- copy, so a place in the library can find the entries written at it.
--
-- Nullable, and deliberately so: a pin dropped by clicking the map, imported
-- from a CSV or an .ics, or written before this migration has no library row to
-- point at. That is a real state, not missing data.
--
-- No FOREIGN KEY. jrn_entry_locations is module-owned and sys_locations is
-- platform-owned; a hard constraint would let the library block a delete inside
-- a module that is meant to know nothing about it. Deleting a saved place
-- leaves the id dangling and the entry entirely readable from its own copy,
-- which is the promise jrn_entry_locations has always made.
ALTER TABLE jrn_entry_locations ADD COLUMN saved_location_id INTEGER;

-- Both reads this exists for filter on this column: "how many entries link to
-- each saved place" and "every entry at this saved place". Without the index
-- each is a full scan of every pin ever written.
CREATE INDEX IF NOT EXISTS idx_jrn_entry_locations_saved_location_id
  ON jrn_entry_locations (saved_location_id);
