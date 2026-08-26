-- My Journal: prefill templates -- a named set of field values that a new entry
-- can be started from.
--
-- The want: most entries of a kind repeat the same handful of values. A "Gym"
-- entry is always the same categories, the same tags and the same place; only the
-- content changes. A template stores those once so a new entry starts filled in
-- rather than blank.
--
-- No DB-level foreign keys -- the repository maintains the links, per project
-- convention. This table has no links to maintain: a template is copied into an
-- entry at apply-time and nothing points back, which is also why deleting one is
-- safe and needs no cascade.

CREATE TABLE jrn_prefill_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',

  -- Disable rather than delete. A template that is out of season -- a holiday
  -- one, a project that paused -- should stop cluttering the New Entry dropdown
  -- without losing the values that took time to assemble. Disabled templates
  -- stay listed and editable on the Templates screen; only the entry form
  -- filters on this.
  is_enabled  INTEGER NOT NULL DEFAULT 1,

  -- WHY THE FIELDS ARE JSON AND NOT CHILD ROWS. A template is read and written
  -- WHOLE, every time: the editor loads all of it to populate the form, and a
  -- save rewrites all of it. A `jrn_prefill_template_fields` child table would
  -- buy exactly one query -- "which templates mention Title" -- that nothing in
  -- the product asks, in exchange for a join on every read and a delete-insert
  -- on every write. `mus_magic_list` (0057) made the same call for the same
  -- reason, and `jrn_saved_filters.filter_json` (0043) did it inside this very
  -- module.
  --
  -- Shape: an array of { field, mode, value }.
  --   field -- one of the keys in JOURNAL_PREFILL_FIELDS (title, content,
  --            placeName, categories, tags, date, time). Validated on the way
  --            in and again, forgivingly, on the way out.
  --   mode  -- 'literal' (use `value` as typed) or 'now' (resolve at apply-time).
  --   value -- the literal text; '' when mode is 'now'.
  --
  -- WHY `mode` EXISTS AT ALL, rather than just storing a string. A stored literal
  -- date would pin every new entry to a fixed day in the past, which is the one
  -- thing a date prefill must not do -- the template would need re-editing daily
  -- to stay useful. So date and time carry a choice: a literal value, or "current
  -- date"/"current time" resolved when the template is applied. `mode` is stored
  -- rather than inferred from a sentinel string like '@now' because a sentinel is
  -- indistinguishable from someone legitimately typing that text into a title.
  --
  -- 'now' is only legal on date and time; the schema rejects it elsewhere. There
  -- is no "current place" or "current weather" to resolve -- both already have
  -- their own GPS-backed buttons on the entry form, which do it live and better
  -- than a stored template could.
  fields_json TEXT    NOT NULL DEFAULT '[]',

  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One template per name, NOCASE -- matching idx_jrn_saved_filters_name (0043)
-- and idx_mus_magic_list_name (0057). "Gym" and "gym" are one template to the
-- writer, and saving the second should be told it already exists rather than
-- silently making a twin the dropdown then shows twice.
--
-- Note this is a plain UNIQUE INDEX on a text column, not on a date -- the trap
-- coding-guide.md warns about does not apply here.
CREATE UNIQUE INDEX idx_jrn_prefill_templates_name
  ON jrn_prefill_templates (name COLLATE NOCASE);

CREATE TRIGGER jrn_prefill_templates_set_updated_at
AFTER UPDATE ON jrn_prefill_templates
FOR EACH ROW
BEGIN
  UPDATE jrn_prefill_templates SET updated_at = datetime('now') WHERE id = old.id;
END;
