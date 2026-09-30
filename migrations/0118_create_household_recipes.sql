-- The Household module's first tables: the recipe box.
--
-- hsh_ is a new module namespace (coding-guide.md), not an abbreviation of
-- "recipe" — Household is explicitly a container for more than one thing
-- (receipts, the HSA), so naming the prefix after its first feature would age
-- exactly the way sql_ would have for Tools. The HSA Tracker's tables, when it
-- gets any, sit under this same prefix without a rename.
--
-- No DB-level foreign keys, following the jrn_/att_ convention here: the
-- cascade from a recipe to its tags is the repository's job, inside the same
-- transaction as the delete.

CREATE TABLE hsh_recipes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  description       TEXT    NOT NULL DEFAULT '',
  -- One item per line, as typed. Stored as one block rather than as structured
  -- quantity/unit/item rows: a plain list is what a cook reads off a phone, and
  -- parsing quantities would only buy a recipe-scaling feature nobody asked for.
  -- Promoting this to its own table later is an additive migration.
  ingredients       TEXT    NOT NULL DEFAULT '',
  directions        TEXT    NOT NULL DEFAULT '',
  notes             TEXT    NOT NULL DEFAULT '',
  -- The dish photograph, with its mime type alongside — the established pattern
  -- from exp_creditcard_accounts.card_image (0031), exp_categories.icon_image
  -- (0034), stk_investment_accounts.icon_image (0037) and jrn_categories (0042).
  -- The bytes are served by a dedicated route rather than inlined as a base64
  -- data URL, so they never bloat a JSON payload and the browser can cache them.
  -- Reads of the recipe LIST must select columns explicitly and derive
  -- `picture IS NOT NULL`, never SELECT *, or every list pulls every photograph.
  picture           BLOB,                        -- NULL = no picture
  picture_mime_type TEXT,
  -- How many times it has been made. Its own counter with its own use-case, so
  -- "I made this again" is one click and cannot race a concurrent edit of the
  -- notes the way re-submitting the whole form would.
  made_count        INTEGER NOT NULL DEFAULT 0,
  -- 1-10, and genuinely NULLable: unrated and "rated 1" are different facts, and
  -- defaulting to a number would silently invent an opinion. The bound is
  -- enforced in zod rather than by a CHECK so the message reaches the form —
  -- and so widening the scale later needs no table rebuild (a CHECK cannot be
  -- altered in SQLite; changing one means the full copy-rename-drop dance).
  rating            INTEGER,
  source_url        TEXT    NOT NULL DEFAULT '',
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The list's default ordering, and the column the search box's LIKE scans.
CREATE INDEX idx_hsh_recipes_name ON hsh_recipes (name);

CREATE TRIGGER hsh_recipes_set_updated_at
AFTER UPDATE ON hsh_recipes
FOR EACH ROW
BEGIN
  UPDATE hsh_recipes SET updated_at = datetime('now') WHERE id = old.id;
END;

-- Tags, normalized into rows rather than kept as a comma-separated column —
-- the same call jrn_entry_tags made (0027), and for the same reasons: the grid
-- filters on one, and the SQL Explorer can JOIN and GROUP BY it.
--
-- There is deliberately no managed `hsh_tags` catalog table the way Journal has
-- `jrn_tags`. Nothing here needs a per-tag description or icon yet, so tags are
-- created inline as a recipe is written; the repository lower-cases and trims
-- them at the boundary, which is what keeps "Weeknight" and "weeknight" one tag
-- with no catalog to reconcile them against.
CREATE TABLE hsh_recipe_tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id  INTEGER NOT NULL,
  tag_name   TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Makes re-tagging idempotent: the repository inserts with OR IGNORE, so adding
-- a tag a recipe already carries is a no-op rather than a duplicate row.
CREATE UNIQUE INDEX idx_hsh_recipe_tags_unique
  ON hsh_recipe_tags (recipe_id, tag_name);
CREATE INDEX idx_hsh_recipe_tags_recipe_id
  ON hsh_recipe_tags (recipe_id);
-- The tag filter's own lookup: "every recipe tagged freezer".
CREATE INDEX idx_hsh_recipe_tags_tag_name
  ON hsh_recipe_tags (tag_name);
