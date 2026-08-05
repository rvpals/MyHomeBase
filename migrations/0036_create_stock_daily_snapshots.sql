-- One row per calendar day recording what the portfolio was worth and how it
-- moved. snapshot_date is the primary key, so re-running a capture on the same
-- day overwrites that day rather than appending a second row.

CREATE TABLE stk_daily_snapshots (
  snapshot_date         TEXT PRIMARY KEY,
  stock_value_cents     INTEGER NOT NULL DEFAULT 0,
  etf_value_cents       INTEGER NOT NULL DEFAULT 0,
  other_value_cents     INTEGER NOT NULL DEFAULT 0,
  total_value_cents     INTEGER NOT NULL DEFAULT 0,
  stock_gain_loss_cents INTEGER NOT NULL DEFAULT 0,
  etf_gain_loss_cents   INTEGER NOT NULL DEFAULT 0,
  other_gain_loss_cents INTEGER NOT NULL DEFAULT 0,
  total_gain_loss_cents INTEGER NOT NULL DEFAULT 0,
  position_count        INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TRIGGER stock_daily_snapshots_set_updated_at
AFTER UPDATE ON stk_daily_snapshots
FOR EACH ROW
BEGIN
  UPDATE stk_daily_snapshots SET updated_at = datetime('now')
  WHERE snapshot_date = old.snapshot_date;
END;
