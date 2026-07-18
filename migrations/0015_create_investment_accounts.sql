CREATE TABLE investment_accounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  description       TEXT    NOT NULL DEFAULT '',
  initial_value_cents INTEGER NOT NULL DEFAULT 0,
  last_value_cents  INTEGER,
  last_updated_at   TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER investment_accounts_set_updated_at
AFTER UPDATE ON investment_accounts
FOR EACH ROW
BEGIN
  UPDATE investment_accounts SET updated_at = datetime('now') WHERE id = old.id;
END;

CREATE TABLE account_performance_records (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id      INTEGER NOT NULL,
  total_value_cents INTEGER NOT NULL DEFAULT 0,
  record_date     TEXT NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_account_performance_records_account_id_record_date
  ON account_performance_records (account_id, record_date);

CREATE TRIGGER account_performance_records_set_updated_at
AFTER UPDATE ON account_performance_records
FOR EACH ROW
BEGIN
  UPDATE account_performance_records SET updated_at = datetime('now') WHERE id = old.id;
END;
