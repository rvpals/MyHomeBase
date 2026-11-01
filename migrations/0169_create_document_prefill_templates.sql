-- Document Library: prefill templates -- a named set of field values a new
-- document can be filed from.
--
-- The want is the Journal's, one module over (0062): documents of a kind repeat
-- the same handful of values. Every utility bill is the same category, the same
-- tags and a title that differs by a month; every insurance policy is filed the
-- same way. Only the attached file is genuinely new each time. A template stores
-- those values once under a name so the New Document form starts filled in.
--
-- No DB-level foreign keys -- the repository maintains the links, per project
-- convention. This table has no links to maintain: a template is copied into the
-- form at apply-time and nothing points back, which is also why deleting one is
-- safe and needs no cascade.

CREATE TABLE doc_prefill_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',

  -- Disable rather than delete, exactly as jrn_prefill_templates does. A
  -- template for a filing season that has passed -- last year's taxes, a closed
  -- claim -- should stop cluttering the New Document dropdown without losing
  -- values that took time to assemble. Disabled templates stay listed and
  -- editable on the Prefill Templates screen; only the editor form filters on
  -- this.
  is_enabled  INTEGER NOT NULL DEFAULT 1,

  -- WHY THE FIELDS ARE JSON AND NOT CHILD ROWS. The same call 0062 made, for the
  -- same reason: a template is read and written WHOLE, every time. The editor
  -- loads all of it to populate the form, and a save rewrites all of it. A
  -- `doc_prefill_template_fields` child table would buy exactly one query --
  -- "which templates mention Title" -- that nothing in the product asks, in
  -- exchange for a join on every read and a delete-insert on every write.
  --
  -- Shape: an array of { field, mode, value }.
  --   field -- one of the keys in DOCUMENT_PREFILL_FIELDS (title, description,
  --            categories, tags). Validated on the way in and again,
  --            forgivingly, on the way out.
  --   mode  -- 'literal'. See below.
  --   value -- the literal text.
  fields_json TEXT    NOT NULL DEFAULT '[]',

  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One template per name, NOCASE -- matching idx_jrn_prefill_templates_name
-- (0062). "Utility bill" and "utility bill" are one template to the filer, and
-- saving the second should be told it already exists rather than silently making
-- a twin the dropdown then shows twice.
--
-- A plain UNIQUE INDEX on a text column, not on a date -- the trap
-- coding-guide.md warns about does not apply here.
CREATE UNIQUE INDEX idx_doc_prefill_templates_name
  ON doc_prefill_templates (name COLLATE NOCASE);

CREATE TRIGGER doc_prefill_templates_set_updated_at
AFTER UPDATE ON doc_prefill_templates
FOR EACH ROW
BEGIN
  UPDATE doc_prefill_templates SET updated_at = datetime('now') WHERE id = old.id;
END;
