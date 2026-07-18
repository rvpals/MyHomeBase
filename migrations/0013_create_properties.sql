CREATE TABLE properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL,
  purchase_price_cents INTEGER NOT NULL,
  purchase_date TEXT NOT NULL,
  current_value_cents INTEGER NOT NULL,
  mortgage_balance_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER properties_set_updated_at
AFTER UPDATE ON properties
FOR EACH ROW
BEGIN
  UPDATE properties SET updated_at = datetime('now') WHERE id = old.id;
END;
