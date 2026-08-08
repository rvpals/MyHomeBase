-- One row per ticker, holding the computed risk figures the ticker viewer's
-- Risks card shows. Written by the ticker-overview use-case, never wholesale —
-- see the .md log for why this is not stk_stock_volatility_cache.
CREATE TABLE stk_ticker_risk_cache (
  ticker                  TEXT PRIMARY KEY,
  annualized_vol_pct      REAL    NOT NULL DEFAULT 0,
  daily_std_dev_pct       REAL    NOT NULL DEFAULT 0,
  volatility_label        TEXT    NOT NULL DEFAULT '',
  low_52w_cents           INTEGER NOT NULL DEFAULT 0,
  high_52w_cents          INTEGER NOT NULL DEFAULT 0,
  current_price_cents     INTEGER NOT NULL DEFAULT 0,
  range_position_pct      REAL    NOT NULL DEFAULT 0,
  -- Nullable on purpose: NULL is "the benchmark leg was unavailable", which is
  -- a different statement from a correlation of 0.
  market_correlation      REAL,
  market_benchmark_ticker TEXT    NOT NULL DEFAULT '',
  annualized_return_pct   REAL    NOT NULL DEFAULT 0,
  sample_count            INTEGER NOT NULL DEFAULT 0,
  calculated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
