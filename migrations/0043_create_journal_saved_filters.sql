-- Named, reusable entry filters for the My Journal "Entries" browser. A user
-- builds a set of conditions in the UI, names it, and picks it from a dropdown
-- later; the selected filter drives the result list and is shown back as
-- readable criteria.
--
-- Shaped after csv_chart_presets (0022) rather than csv_named_mappings (0019):
-- UNIQUE (name) makes "save" a single upsert-by-name instead of separate
-- create/update paths, which is the newer and simpler of the two precedents.
-- Shared by all users — there is no owner column, matching how named mappings
-- and chart presets already work in this app.
--
-- filter_json holds the condition tree. This is a deliberate JSON-blob
-- exception on the same grounds as csv_chart_presets.options_json (0022),
-- csv_named_mappings.column_mapping_json (0019) and csv_analytics_entries
-- .columns_json (0021): the payload is a variable-shape bag defined by the
-- filter builder, it is replaced wholesale on every save, it has no stable
-- relational form (one level of AND/OR groups, each holding N conditions of
-- differing field types), and it is never queried by SQL — the repository reads
-- the row, parses it, and compiles a WHERE clause in code. Normalizing it would
-- mean two child tables (groups, conditions) that are only ever read and written
-- as a whole tree, and every new condition type would need a migration. Kept as
-- JSON, the schema absorbs a new field family (GPS/location conditions are
-- planned but deliberately not built yet) with no schema change at all.
--
-- No DB-level foreign key, per project convention: nothing references this
-- table, and it references nothing.
CREATE TABLE jrn_saved_filters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  filter_json TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (name)
);

CREATE TRIGGER jrn_saved_filters_set_updated_at
AFTER UPDATE ON jrn_saved_filters
FOR EACH ROW
BEGIN
  UPDATE jrn_saved_filters SET updated_at = datetime('now') WHERE id = old.id;
END;
