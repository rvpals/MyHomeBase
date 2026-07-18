CREATE TABLE stock_positions (
  ticker              TEXT PRIMARY KEY,
  name                TEXT    NOT NULL DEFAULT '',
  type                TEXT    NOT NULL DEFAULT 'Stock',
  current_price_cents INTEGER NOT NULL DEFAULT 0,
  quantity            REAL    NOT NULL DEFAULT 0,
  day_gain_loss_cents INTEGER NOT NULL DEFAULT 0,
  value_cents         INTEGER NOT NULL DEFAULT 0,
  day_high_cents      INTEGER NOT NULL DEFAULT 0,
  day_low_cents       INTEGER NOT NULL DEFAULT 0,
  dividend_rate_cents INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER stock_positions_set_updated_at
AFTER UPDATE ON stock_positions
FOR EACH ROW
BEGIN
  UPDATE stock_positions SET updated_at = datetime('now') WHERE ticker = old.ticker;
END;

CREATE TABLE stock_transactions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_at        TEXT    NOT NULL,
  action                TEXT    NOT NULL DEFAULT 'Buy',
  ticker                TEXT    NOT NULL,
  number_of_shares      REAL    NOT NULL DEFAULT 0,
  price_per_share_cents INTEGER NOT NULL DEFAULT 0,
  total_amount_cents    INTEGER NOT NULL DEFAULT 0,
  note                  TEXT    NOT NULL DEFAULT '',
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_stock_transactions_unique
  ON stock_transactions (transaction_at, action, ticker, total_amount_cents);

CREATE INDEX idx_stock_transactions_ticker
  ON stock_transactions (ticker);

CREATE TRIGGER stock_transactions_set_updated_at
AFTER UPDATE ON stock_transactions
FOR EACH ROW
BEGIN
  UPDATE stock_transactions SET updated_at = datetime('now') WHERE id = old.id;
END;
