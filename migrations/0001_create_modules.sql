CREATE TABLE sys_modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  short_name TEXT NOT NULL,
  long_name TEXT NOT NULL,
  description TEXT,
  sequence INTEGER NOT NULL,
  is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER modules_set_updated_at
AFTER UPDATE ON sys_modules
FOR EACH ROW
BEGIN
  UPDATE sys_modules SET updated_at = datetime('now') WHERE id = old.id;
END;
