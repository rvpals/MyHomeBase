-- The Code Library's recycle bin.
--
-- MIRROR TABLES, NOT A `deleted_at` FLAG ON `cod_snippets`. The same decision
-- migration 0161 made for Clips and 0079 for the Journal, and for the same
-- reason: a flag means every existing read — the list, the board, the chips, the
-- taxonomy usage counts, the CLI — has to learn to exclude binned rows, and one
-- missed WHERE silently serves a deleted snippet. A separate table cannot be read
-- by accident.
--
-- All three of a snippet's tables are mirrored, so a restored snippet comes back
-- with its categories and its tags, not as a bare body. A snippet's labels are
-- part of what makes it findable; restoring it without them would be restoring
-- something less than what was deleted.
--
-- RESTORE AIMS AT THE SNIPPET'S ORIGINAL ID, which is why `snippet_id` is carried
-- here. Nothing points at a snippet today, so nothing breaks if the id changes --
-- but `restoreRecycledEntries` set the precedent for a reason, and a later
-- feature that does reference one (a link from a journal entry, say) would
-- otherwise find a dangling id after any delete-and-restore. Falls back to a
-- fresh id only when the original is taken.
--
-- Deleting is what puts rows here; only emptying the bin destroys them.

CREATE TABLE cod_recycled_snippets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  snippet_id      INTEGER NOT NULL,               -- the id it had in cod_snippets

  title           TEXT    NOT NULL DEFAULT '',
  code            TEXT    NOT NULL DEFAULT '',
  language        TEXT    NOT NULL DEFAULT 'text',

  is_pinned       INTEGER NOT NULL DEFAULT 0,
  card_color      TEXT    NOT NULL DEFAULT '',

  created_by      INTEGER,                        -- -> sys_users.id

  -- The ORIGINAL timestamps, carried rather than regenerated: a restored snippet
  -- should keep the dates it had, or restoring would silently make an old
  -- snippet look new and reorder the whole list.
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,

  deleted_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The bin lists most recently deleted first.
CREATE INDEX idx_cod_recycled_snippets_deleted
  ON cod_recycled_snippets (deleted_at DESC, id DESC);
CREATE INDEX idx_cod_recycled_snippets_snippet
  ON cod_recycled_snippets (snippet_id);

-- The pairings, mirrored. Keyed by the BIN row's id, not the original snippet's:
-- the same snippet id could be binned, restored and binned again, and keying on
-- it would merge two separate deletions' labels.
CREATE TABLE cod_recycled_snippet_categories (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  recycled_snippet_id INTEGER NOT NULL,
  category_name       TEXT    NOT NULL,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_cod_recycled_snippet_categories_parent
  ON cod_recycled_snippet_categories (recycled_snippet_id);

CREATE TABLE cod_recycled_snippet_tags (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  recycled_snippet_id INTEGER NOT NULL,
  tag_name            TEXT    NOT NULL,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_cod_recycled_snippet_tags_parent
  ON cod_recycled_snippet_tags (recycled_snippet_id);
