-- Journal: a street address on an entry's own location pin.
--
-- Nullable on purpose, and distinct from jrn_locations.address: this is the
-- entry's own copy, written at the time the pin was added, and it never follows
-- a later edit to the library row. NULL means "no address was captured",
-- which is every row written before this migration and every pin dropped
-- straight on the map without a lookup.
ALTER TABLE jrn_entry_locations
  ADD COLUMN street_address TEXT;
