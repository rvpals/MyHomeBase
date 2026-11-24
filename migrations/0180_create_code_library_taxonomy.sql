-- Categories and tags for the Code Library.
--
-- Same shape as the Clips taxonomy (migration 0155) and the Journal's before it:
-- two managed lists keyed by name, and a pairing table each. A prefix is a module
-- namespace, so these are `cod_` rather than shared with `clp_` — the two modules'
-- vocabularies are separate on purpose. "Receipts" is a useful clip category and a
-- meaningless snippet one.
--
-- WHY A TAXONOMY WHEN `language` ALREADY EXISTS. A language says what a snippet IS
-- written in; a category says what KIND of thing it is (Query, Shell one-liner,
-- Config) and a tag says what it is ABOUT (postgres, docker, this-project). Those
-- are three different questions and filing by one does not answer the others.
--
-- NO ICON COLUMNS, unlike `clp_categories`. Clips carries `icon_image` /
-- `icon_image_mime_type` per taxonomy row, which forces every read to name its
-- columns or drag every icon's bytes into memory (the trap TAXONOMY_COLUMNS exists
-- to avoid there). Snippet chips are text, so the columns are left out rather than
-- added "for symmetry" and then always selected around. A later migration can add
-- them if the chips ever want artwork.
--
-- No DB-level foreign keys, per project convention — the repository maintains the
-- pairings and clears a snippet's in the same transaction as the snippet.

-- Managed category list. Keyed by name, the natural-key precedent `clp_categories`
-- and `jrn_categories` both set: the pairing table references the name, not a
-- surrogate id.
CREATE TABLE cod_categories (
  name        TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One category per name, case-insensitively. COLLATE NOCASE on the index rather
-- than on the column, so the stored value keeps the writer's own capitalisation
-- ("Query", not "query") while a near-duplicate is still refused — two chips
-- reading "Shell" and "shell" are indistinguishable at a glance.
CREATE UNIQUE INDEX idx_cod_categories_name ON cod_categories (name COLLATE NOCASE);

CREATE TRIGGER cod_categories_set_updated_at
AFTER UPDATE ON cod_categories
FOR EACH ROW
BEGIN
  UPDATE cod_categories SET updated_at = datetime('now') WHERE name = old.name;
END;

-- Managed tag list. Same shape and same reasoning as the categories above.
CREATE TABLE cod_tags (
  name        TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_cod_tags_name ON cod_tags (name COLLATE NOCASE);

CREATE TRIGGER cod_tags_set_updated_at
AFTER UPDATE ON cod_tags
FOR EACH ROW
BEGIN
  UPDATE cod_tags SET updated_at = datetime('now') WHERE name = old.name;
END;

-- Snippet <-> category pairings (many-to-many).
CREATE TABLE cod_snippet_categories (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  snippet_id    INTEGER NOT NULL,
  category_name TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_cod_snippet_categories_unique
  ON cod_snippet_categories (snippet_id, category_name);
CREATE INDEX idx_cod_snippet_categories_snippet ON cod_snippet_categories (snippet_id);
CREATE INDEX idx_cod_snippet_categories_name ON cod_snippet_categories (category_name);

CREATE TABLE cod_snippet_tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  snippet_id INTEGER NOT NULL,
  tag_name   TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_cod_snippet_tags_unique ON cod_snippet_tags (snippet_id, tag_name);
CREATE INDEX idx_cod_snippet_tags_snippet ON cod_snippet_tags (snippet_id);
CREATE INDEX idx_cod_snippet_tags_name ON cod_snippet_tags (tag_name);
