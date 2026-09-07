-- CSV Analysis: named, reusable views over one imported dataset.
--
-- A view is a saved query definition against ONE entry's physical table:
-- which columns to select, the criteria to filter by, how to order, and how
-- many records to show per page. The Dashboard's per-entry dropdown offers an
-- entry's enabled views; picking one re-reads the table through it.
--
-- Shaped after jrn_saved_filters (0043) and csv_chart_presets (0022):
-- UNIQUE (entry_id, name) makes "save" a single upsert-by-name rather than
-- separate create/update paths.
--
-- The three _json columns are a deliberate JSON-blob exception on exactly the
-- grounds already documented for csv_chart_presets.options_json (0022),
-- jrn_saved_filters.filter_json (0043) and csv_analytics_entries.columns_json
-- (0021): each is a variable-shape list defined by the view builder, replaced
-- wholesale on every save, and never queried by SQL -- the repository reads the
-- row, parses it, and compiles a SELECT in code (src/lib/csv-analytics/
-- view-query.ts). Normalising them would mean three child tables that are only
-- ever read and written as a whole, and every new operator would need a
-- migration.
--
-- records_per_page and is_enabled are real columns rather than part of a blob:
-- paging is applied on every read of a view, and is_enabled decides whether a
-- view appears in the entry dropdown at all. Both are first-class facts about
-- the view, not part of its query shape.
--
-- No DB-level foreign key on entry_id, per project convention. Deleting an
-- entry drops its views inside the same transaction that drops its physical
-- table (SqliteCsvAnalyticsRepository.deleteEntry), exactly as it already does
-- for that entry's chart presets.
CREATE TABLE csv_custom_views (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id              INTEGER NOT NULL,          -- -> csv_analytics_entries.id
  name                  TEXT    NOT NULL,
  description           TEXT,
  -- string[] of csv_analytics_entries.columns_json[].name, in display order.
  -- An empty array means "every column", so a view survives its entry gaining one.
  selected_columns_json TEXT    NOT NULL DEFAULT '[]',
  -- { column, operator, values }[] -- ANDed together. See view-query.ts.
  criteria_json         TEXT    NOT NULL DEFAULT '[]',
  -- { column, direction }[] -- applied in array order.
  order_by_json         TEXT    NOT NULL DEFAULT '[]',
  records_per_page      INTEGER NOT NULL DEFAULT 100,
  is_enabled            INTEGER NOT NULL DEFAULT 1,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entry_id, name)
);

-- The only query shape: every view belonging to one entry, for the builder list
-- and for the Dashboard dropdown.
CREATE INDEX idx_csv_custom_views_entry ON csv_custom_views (entry_id);

CREATE TRIGGER csv_custom_views_set_updated_at
AFTER UPDATE ON csv_custom_views
FOR EACH ROW
BEGIN
  UPDATE csv_custom_views SET updated_at = datetime('now') WHERE id = old.id;
END;
