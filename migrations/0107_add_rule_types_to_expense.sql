-- Groups transaction rules under a user-defined Type.
--
-- The rules list grew past the point where a flat stack reads well: a dozen
-- restaurant patterns, a dozen subscription patterns and a handful of
-- one-off corrections all sit at the same level, and finding the one you
-- came to edit means scanning every row. A Type is the grouping the reader
-- already has in their head; this stores it.
--
-- Two pieces:
--
--   1. exp_rule_types  -- the list the user curates, under Meta Data
--   2. exp_post_import_rules.type_name -- which one a rule belongs to
--
-- Modelled on exp_categories (migration 0029), deliberately:
--
--   * NAME AS THE PRIMARY KEY, not a surrogate id. A rule stores the type as
--     text, exactly as a rule action already stores a category *name*. That
--     keeps the rule row readable on its own, and it means a rule can name a
--     type before that type has been saved to the curated list -- the same
--     "free text is allowed, the list is the shortcut" rule the category and
--     vendor fields already follow.
--
--   * No foreign key, for the same reason. Deleting a type must not delete
--     or block the rules that used it; they fall back to Untyped, which is
--     what deleting a category already does to a transaction.
--
-- type_name is NOT NULL DEFAULT '' so every existing rule reads as Untyped
-- without a backfill. There is no basis to guess a type for a rule written
-- before types existed, and a wrong guess is worse than a blank: it would
-- hide the rule under a heading the author never chose.
--
-- sort_order exists so the filter strip can be ordered deliberately later
-- (most-used types first, rather than alphabetically). Nothing sets it yet;
-- until something does, every row holds 0 and the name is the tiebreak, so
-- the list reads alphabetically.
CREATE TABLE exp_rule_types (
  name        TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER exp_rule_types_set_updated_at
AFTER UPDATE ON exp_rule_types
FOR EACH ROW
BEGIN
  UPDATE exp_rule_types SET updated_at = datetime('now') WHERE name = old.name;
END;

ALTER TABLE exp_post_import_rules ADD COLUMN type_name TEXT NOT NULL DEFAULT '';
