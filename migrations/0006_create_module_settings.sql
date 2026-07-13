CREATE TABLE module_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_id INTEGER NOT NULL,
  setting_key TEXT NOT NULL,
  setting_value TEXT NOT NULL,
  setting_description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (module_id, setting_key)
);

CREATE TRIGGER module_settings_set_updated_at
AFTER UPDATE ON module_settings
FOR EACH ROW
BEGIN
  UPDATE module_settings SET updated_at = datetime('now') WHERE id = old.id;
END;
