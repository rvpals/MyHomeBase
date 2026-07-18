CREATE TABLE stock_volatility_cache (
  ticker             TEXT PRIMARY KEY,
  company_name       TEXT,
  type               TEXT    NOT NULL DEFAULT '',
  shares             REAL    NOT NULL DEFAULT 0,
  current_price_cents INTEGER NOT NULL DEFAULT 0,
  annualized_vol_pct REAL    NOT NULL DEFAULT 0,
  daily_std_dev_pct  REAL    NOT NULL DEFAULT 0,
  volatility_label   TEXT    NOT NULL DEFAULT '',
  low_52w_cents      INTEGER NOT NULL DEFAULT 0,
  high_52w_cents     INTEGER NOT NULL DEFAULT 0,
  range_position_pct REAL    NOT NULL DEFAULT 0,
  sample_count       INTEGER NOT NULL DEFAULT 0,
  calculated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Singleton row (id always 1) — holds the one most-recent portfolio-wide
-- correlation matrix, not one row per ticker. Recomputed wholesale each time.
CREATE TABLE stock_correlation_cache (
  id                      INTEGER PRIMARY KEY DEFAULT 1,
  tickers_json            TEXT NOT NULL DEFAULT '[]',
  matrix_json             TEXT NOT NULL DEFAULT '[]',
  market_correlation_json TEXT NOT NULL DEFAULT '{}',
  failed_tickers_json     TEXT NOT NULL DEFAULT '[]',
  calculated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Singleton row (id always 1) — same pattern as stock_correlation_cache.
CREATE TABLE stock_sharpe_cache (
  id                        INTEGER PRIMARY KEY DEFAULT 1,
  risk_free_rate            REAL    NOT NULL DEFAULT 0,
  lookback_days             INTEGER NOT NULL DEFAULT 0,
  sharpe_ratio              REAL,
  annualized_return         REAL    NOT NULL DEFAULT 0,
  annualized_volatility     REAL    NOT NULL DEFAULT 0,
  aligned_trading_days      INTEGER NOT NULL DEFAULT 0,
  mean_daily_return         REAL    NOT NULL DEFAULT 0,
  daily_risk_free_rate      REAL    NOT NULL DEFAULT 0,
  calculation_date          TEXT    NOT NULL DEFAULT '',
  ticker_details_json       TEXT    NOT NULL DEFAULT '[]',
  portfolio_return_series_json TEXT NOT NULL DEFAULT '[]',
  skipped_tickers_json      TEXT    NOT NULL DEFAULT '[]',
  skip_reasons_json         TEXT    NOT NULL DEFAULT '{}',
  insufficient_data_reason  TEXT,
  calculated_at             TEXT NOT NULL DEFAULT (datetime('now'))
);
