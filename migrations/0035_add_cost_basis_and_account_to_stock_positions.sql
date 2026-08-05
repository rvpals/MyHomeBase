-- Rebuild stk_stock_positions: re-key on (account_id, ticker) and add the
-- cost-basis, identifier, classification and income columns a brokerage export
-- carries. A rebuild rather than ALTER TABLE ADD COLUMN because the primary key
-- changes, which SQLite cannot do in place.

CREATE TABLE stk_stock_positions_rebuild (
  account_id                 INTEGER NOT NULL DEFAULT 0,
  ticker                     TEXT    NOT NULL,
  name                       TEXT    NOT NULL DEFAULT '',
  type                       TEXT    NOT NULL DEFAULT 'Stock',
  current_price_cents        INTEGER NOT NULL DEFAULT 0,
  quantity                   REAL    NOT NULL DEFAULT 0,
  day_gain_loss_cents        INTEGER NOT NULL DEFAULT 0,
  value_cents                INTEGER NOT NULL DEFAULT 0,
  day_high_cents             INTEGER NOT NULL DEFAULT 0,
  day_low_cents              INTEGER NOT NULL DEFAULT 0,
  dividend_rate_cents        INTEGER NOT NULL DEFAULT 0,
  cost_cents                 INTEGER NOT NULL DEFAULT 0,
  unit_cost_cents            INTEGER NOT NULL DEFAULT 0,
  unrealized_gain_loss_cents INTEGER NOT NULL DEFAULT 0,
  unrealized_gain_loss_pct   REAL    NOT NULL DEFAULT 0,
  cusip                      TEXT    NOT NULL DEFAULT '',
  isin                       TEXT    NOT NULL DEFAULT '',
  asset_class                TEXT    NOT NULL DEFAULT '',
  asset_strategy             TEXT    NOT NULL DEFAULT '',
  est_annual_income_cents    INTEGER NOT NULL DEFAULT 0,
  income_earned_cents        INTEGER NOT NULL DEFAULT 0,
  created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                 TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, ticker)
);

-- Existing rows predate accounts, so they land in account 0 ("Unassigned").
-- The new columns take their defaults; nothing is invented for them.
INSERT INTO stk_stock_positions_rebuild
  (account_id, ticker, name, type, current_price_cents, quantity,
   day_gain_loss_cents, value_cents, day_high_cents, day_low_cents,
   dividend_rate_cents, created_at, updated_at)
SELECT
  0, ticker, name, type, current_price_cents, quantity,
  day_gain_loss_cents, value_cents, day_high_cents, day_low_cents,
  dividend_rate_cents, created_at, updated_at
FROM stk_stock_positions;

-- The trigger names the old table, so it goes before the table it belongs to.
DROP TRIGGER stock_positions_set_updated_at;
DROP TABLE stk_stock_positions;
ALTER TABLE stk_stock_positions_rebuild RENAME TO stk_stock_positions;

-- Cross-account lookups ("every account holding NVDA") no longer hit the primary
-- key's leading column, so ticker gets its own index.
CREATE INDEX idx_stock_positions_ticker ON stk_stock_positions (ticker);

CREATE TRIGGER stock_positions_set_updated_at
AFTER UPDATE ON stk_stock_positions
FOR EACH ROW
BEGIN
  UPDATE stk_stock_positions SET updated_at = datetime('now')
  WHERE account_id = old.account_id AND ticker = old.ticker;
END;
