CREATE TABLE csv_analytics_entries (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  name                     TEXT    NOT NULL,
  description              TEXT,
  table_name               TEXT    NOT NULL UNIQUE,
  columns_json             TEXT    NOT NULL DEFAULT '[]',
  primary_key_fields_json  TEXT    NOT NULL DEFAULT '[]',
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER csv_analytics_entries_set_updated_at
AFTER UPDATE ON csv_analytics_entries
FOR EACH ROW
BEGIN
  UPDATE csv_analytics_entries SET updated_at = datetime('now') WHERE id = old.id;
END;
