-- Singleton-per-type row: the most recently used column mapping for each
-- import type, offered as the starting point next time that type is imported.
CREATE TABLE csv_import_mappings (
  import_type         TEXT PRIMARY KEY,
  column_mapping_json TEXT NOT NULL DEFAULT '{}',
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER csv_import_mappings_set_updated_at
AFTER UPDATE ON csv_import_mappings
FOR EACH ROW
BEGIN
  UPDATE csv_import_mappings SET updated_at = datetime('now') WHERE import_type = old.import_type;
END;

-- Named, reusable mapping presets a user can save and pick from later —
-- distinct from the single "last used" row above.
CREATE TABLE csv_named_mappings (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL,
  import_type          TEXT    NOT NULL,
  column_mapping_json  TEXT    NOT NULL DEFAULT '{}',
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_csv_named_mappings_import_type
  ON csv_named_mappings (import_type);

CREATE TRIGGER csv_named_mappings_set_updated_at
AFTER UPDATE ON csv_named_mappings
FOR EACH ROW
BEGIN
  UPDATE csv_named_mappings SET updated_at = datetime('now') WHERE id = old.id;
END;
