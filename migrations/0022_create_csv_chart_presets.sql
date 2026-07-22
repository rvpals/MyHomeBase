CREATE TABLE csv_chart_presets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id     INTEGER NOT NULL REFERENCES csv_analytics_entries(id) ON DELETE CASCADE,
  name         TEXT    NOT NULL,
  options_json TEXT    NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (entry_id, name)
);

CREATE INDEX csv_chart_presets_entry_id ON csv_chart_presets (entry_id);

CREATE TRIGGER csv_chart_presets_set_updated_at
AFTER UPDATE ON csv_chart_presets
FOR EACH ROW
BEGIN
  UPDATE csv_chart_presets SET updated_at = datetime('now') WHERE id = old.id;
END;
