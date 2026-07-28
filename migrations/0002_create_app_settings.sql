CREATE TABLE sys_app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER app_settings_set_updated_at
AFTER UPDATE ON sys_app_settings
FOR EACH ROW
BEGIN
  UPDATE sys_app_settings SET updated_at = datetime('now') WHERE key = old.key;
END;

INSERT INTO sys_app_settings (key, value, description)
VALUES ('application_name', 'MyHomeBase', 'Displayed as the application''s name throughout the UI.');
