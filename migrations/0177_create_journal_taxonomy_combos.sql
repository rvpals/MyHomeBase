-- My Journal: taxonomy combos -- a named, reusable set of categories AND tags that
-- an entry's two taxonomy fields can be filled from in one click.
--
-- The want: a prefill template (0062) covers "a whole kind of entry" -- the date,
-- the title skeleton, the place, the content, and the taxonomy. But most of the
-- repetition in practice is *only* the taxonomy: the same three categories and six
-- tags go on a gym entry whatever else changes, and on an existing entry being
-- corrected there is no template to start from at all, because the entry already
-- exists. A combo is that slice on its own, usable from both the New Entry form and
-- the editor of an entry written months ago.
--
-- WHY THIS IS NOT A PREFILL TEMPLATE WITH TWO FIELDS. Three reasons, and the third
-- is the one that settles it:
--   1. A template fills only blanks and never overwrites (see applyPrefillTemplate).
--      A combo deliberately REPLACES both lists wholesale -- that is what makes it
--      usable for fixing an entry that is already tagged wrongly.
--   2. A template is offered on New Entry only; a combo is offered in both editors.
--   3. The two are picked at different moments for different reasons, so folding
--      them together would mean one dropdown whose entries behave in two different
--      ways depending on which fields they happen to name. That is not a UI anyone
--      can predict.
--
-- WHY THE NAMES ARE JSON AND NOT CHILD ROWS. The same call 0062 made, for the same
-- reason, inside this same module: a combo is read and written WHOLE every time --
-- the editor loads all of it, a save rewrites all of it, and applying it replaces
-- both lists at once. A `jrn_taxonomy_combo_categories` + `..._tags` pair would buy
-- "which combos mention HEALTH", which nothing in the product asks, in exchange for
-- two joins on every read and a delete-insert on every write.
--
-- It also matches how the rest of this module already stores taxonomy names:
-- `jrn_saved_filters.filter_json` (0043) and `jrn_prefill_templates.fields_json`
-- (0062) both hold names as JSON rather than as foreign keys. The consequence is
-- shared with them and is NOT optional: a category or tag RENAME, and a taxonomy
-- MERGE, must rewrite these rows too, because nothing here is a foreign key.
-- `src/lib/journal/taxonomy-merge.ts` already follows a merge into saved filters and
-- prefill templates; this migration adds a third place it has to follow, and the
-- merge plan reports the affected combos by name before anything is written.
--
-- Shape of each column: a JSON array of plain strings, e.g. ["HEALTH","FAMILY"].
-- Order is preserved -- it is the order the chips were added, and the order they are
-- written back onto the entry. Read back forgivingly (a rotted row comes back empty
-- and re-editable, never a 500), exactly as parseStoredPrefillFields does.
--
-- An EMPTY array is a real, meaningful value and not "unset": applying a combo whose
-- tags are [] clears the entry's tags. A combo replaces both lists, so "this kind of
-- entry carries no tags" is something a reader can legitimately express.
--
-- No DB-level foreign keys, per project convention. There is nothing to cascade in
-- either direction: a combo names categories and tags as text, and deleting a combo
-- cannot affect an entry, because applying one copies names onto the entry and
-- nothing points back afterwards.
--
-- No `is_enabled` column, deliberately -- unlike 0062. A template clutters the New
-- Entry dropdown whether or not it is in season, which is what disabling solved
-- there. Combos are reached through a searchable picker rather than a dropdown, so
-- an out-of-season one costs nothing and the column would be a setting nobody needs
-- to find. If that turns out wrong it is one more ALTER.

CREATE TABLE jrn_taxonomy_combos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  description     TEXT    NOT NULL DEFAULT '',

  -- JSON arrays of names, as above. '[]' rather than NULL for an empty set: one
  -- kind of nothing, and the forgiving reader then has a valid document to parse
  -- in every row.
  categories_json TEXT    NOT NULL DEFAULT '[]',
  tags_json       TEXT    NOT NULL DEFAULT '[]',

  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One combo per name, NOCASE -- matching idx_jrn_prefill_templates_name (0062),
-- idx_jrn_saved_filters_name (0043) and idx_mus_magic_list_name (0057). "Gym" and
-- "gym" are one combo to the writer, and saving the second should be told it already
-- exists rather than silently making a twin the picker then lists twice.
--
-- A plain UNIQUE INDEX on a text column, not on a date -- the trap coding-guide.md
-- warns about does not apply here.
CREATE UNIQUE INDEX idx_jrn_taxonomy_combos_name
  ON jrn_taxonomy_combos (name COLLATE NOCASE);

CREATE TRIGGER jrn_taxonomy_combos_set_updated_at
AFTER UPDATE ON jrn_taxonomy_combos
FOR EACH ROW
BEGIN
  UPDATE jrn_taxonomy_combos SET updated_at = datetime('now') WHERE id = old.id;
END;
