CREATE TABLE stock_watch_lists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER stock_watch_lists_set_updated_at
AFTER UPDATE ON stock_watch_lists
FOR EACH ROW
BEGIN
  UPDATE stock_watch_lists SET updated_at = datetime('now') WHERE id = old.id;
END;

CREATE TABLE stock_watch_list_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_list_id      INTEGER NOT NULL,
  ticker             TEXT    NOT NULL,
  shares             REAL    NOT NULL DEFAULT 0,
  price_when_added_cents INTEGER NOT NULL DEFAULT 0,
  added_date         TEXT    NOT NULL,
  reminder_at        TEXT,
  reminder_message   TEXT    NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_stock_watch_list_items_watch_list_id
  ON stock_watch_list_items (watch_list_id);

CREATE TRIGGER stock_watch_list_items_set_updated_at
AFTER UPDATE ON stock_watch_list_items
FOR EACH ROW
BEGIN
  UPDATE stock_watch_list_items SET updated_at = datetime('now') WHERE id = old.id;
END;
