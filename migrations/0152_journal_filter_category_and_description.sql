-- Label a saved journal filter with a category, and give it a description.
--
-- The Entries screen's filter dropdown is one flat list ordered by name
-- (migration 0043). That is fine for a handful of filters and stops being fine
-- at thirty: a reader with filters about the car, the house and the kids has no
-- way to see only the car ones. `category_name` is what the new "Show filters
-- by: category first" mode in the Filtering card groups on.
--
-- Free text, with no catalog table. This is deliberate and follows
-- `hsh_recipes.category` (migration 0120) rather than `jrn_categories`: a filter
-- label wants to be typed inline while naming the filter, and it needs neither a
-- description of its own nor an uploadable icon. Giving it a managed catalog
-- would mean an admin screen nobody asked for and an icon column it never uses.
-- The UI offers every value already in use through a `<datalist>`, so the
-- common path is still picking rather than typing.
--
-- `TEXT NOT NULL DEFAULT ''` rather than nullable, both columns: '' means
-- "uncategorised" / "no description", exactly as `exp_transactions.category_name`
-- (migration 0029) already uses blank for "not categorised yet". One kind of
-- nothing, so no reader has to handle two.
--
-- Every existing row therefore becomes an uncategorised filter with no
-- description, which is the correct reading of a filter saved before this
-- existed. Nothing is backfilled and nothing needs to be: the card's default
-- mode is still "by Filter name", so a reader who never opens the new control
-- sees exactly the screen they saw yesterday.
ALTER TABLE jrn_saved_filters ADD COLUMN category_name TEXT NOT NULL DEFAULT '';
ALTER TABLE jrn_saved_filters ADD COLUMN description   TEXT NOT NULL DEFAULT '';

-- The grouped mode's two reads: "every distinct category" and "the filters in
-- this one, by name". `COLLATE NOCASE` on the index rather than the column so
-- the stored value keeps the typed capitalisation ("CAR", not "car") while
-- "Car" and "CAR" still group together and sort as one.
CREATE INDEX idx_jrn_saved_filters_category
  ON jrn_saved_filters (category_name COLLATE NOCASE, name);
