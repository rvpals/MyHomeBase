-- Named, reusable SQL statements for the Admin -> SQL Explorer -> SQL Query tab.
-- An admin types a statement, names it, and loads it back later from the
-- "Saved SQL" card instead of retyping it.
--
-- Prefix is sys_, not a feature-module prefix: SQL Explorer is a platform admin
-- screen rather than a module, the same reasoning that put sys_messages (0109)
-- here. See coding-guide.md, "Database table naming".
--
-- Shaped after jrn_saved_filters (0043) and csv_chart_presets (0022):
-- UNIQUE (name) makes "save" a single upsert-by-name rather than separate
-- create and update paths. Saving under an existing name replaces that row's
-- description, tags and statement; the save dialog says so before it happens.
--
-- HOUSEHOLD-WIDE. No user_id, matching sys_messages (0109), jrn_saved_filters
-- and csv_chart_presets. Every reader of this table is already an admin -- the
-- screen is behind requireAdmin() and so is every action -- so there is no
-- privacy line an owner column would be drawing, only extra rows and extra
-- code. A saved query is a shared piece of household tooling, like a bookmark.
--
-- No DB-level foreign key, per project convention: nothing references this
-- table, and it references nothing.
CREATE TABLE sys_saved_sql_queries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',

  -- Comma-joined, e.g. "investments,debugging". A deliberate denormalization,
  -- and the one choice here worth defending.
  --
  -- The Journal's tags get three tables (jrn_tags, jrn_entry_tags and a
  -- taxonomy screen) because tags there are BROWSABLE: the reader filters by
  -- them, renames them, and sees them listed. These are not. They are a label
  -- typed into a save dialog and rendered back as chips on one card, never
  -- queried by SQL and never the subject of a join. A tag table plus a link
  -- table for that would be two tables, a migration, and a cascade delete in
  -- service of a string the code only ever splits on a comma.
  --
  -- If tags here ever grow filtering or renaming, that is the moment to
  -- normalize -- promote on the second caller, per ARCHITECTURE.md.
  tags          TEXT    NOT NULL DEFAULT '',

  -- The statement itself, stored verbatim as typed. Not validated as SQL on the
  -- way in and not restricted to SELECT: the SQL Query tab deliberately runs
  -- writes too, and a saved statement is only text until someone loads it into
  -- the editor and presses Execute. Loading does NOT execute, precisely so a
  -- saved DELETE cannot fire on a single click.
  sql_statement TEXT    NOT NULL,

  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),

  -- Names the row exactly -- this is what makes save an upsert. Per the rule in
  -- coding-guide.md, a unique index may only span columns that identify the
  -- row, and the name does.
  UNIQUE (name)
);

-- The module's usual updated_at stamp, so "recently saved" sorts correctly on
-- the card without the writer having to remember to set it.
CREATE TRIGGER sys_saved_sql_queries_set_updated_at
AFTER UPDATE ON sys_saved_sql_queries
FOR EACH ROW
BEGIN
  UPDATE sys_saved_sql_queries SET updated_at = datetime('now') WHERE id = old.id;
END;
