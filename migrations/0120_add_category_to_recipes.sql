-- A category per recipe — "what this dish IS": Dinner, Dessert, Breakfast.
--
-- A plain column rather than a catalog table, and a single value rather than a
-- join table. The reasoning is in the .md log; the short version is that the
-- module already HAS a many-valued free-text label (hsh_recipe_tags), so a
-- second one would be the same feature twice.
--
-- NOT NULL DEFAULT '' matches every other text column here: a recipe with no
-- category is blank, never NULL. That also makes this migration safe on a table
-- with rows — every existing recipe becomes uncategorised, which is true.
ALTER TABLE hsh_recipes ADD COLUMN category TEXT NOT NULL DEFAULT '';

-- Feeds two queries: the list's category filter, and the SELECT DISTINCT that
-- builds the "previously used" dropdown. NOCASE because the app matches
-- categories case-insensitively while storing them as typed — see the log.
CREATE INDEX idx_hsh_recipes_category ON hsh_recipes (category COLLATE NOCASE);
