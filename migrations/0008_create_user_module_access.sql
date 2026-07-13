CREATE TABLE user_module_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  module_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, module_id)
);

CREATE INDEX user_module_access_user_id_idx ON user_module_access(user_id);
