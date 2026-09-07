-- Stocks & ETFs: historical purchase lots for the Tax Lot Portfolio Analyzer.
--
-- Separate from stk_stock_transactions on purpose (see the .md log): a transaction
-- records what the broker did, while a lot records what you still hold and needs a
-- flag saying whether its share count is pre- or post-split. Same stk_ prefix, since
-- brokerage and per-stock tables share one namespace.

CREATE TABLE stk_tax_lots (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker                TEXT    NOT NULL,
  -- ISO YYYY-MM-DD. A date, not a timestamp -- which is exactly why nothing here is
  -- UNIQUE on it (see below).
  buy_date              TEXT    NOT NULL,
  -- REAL, not INTEGER: fractional shares are ordinary, and a 40x split normalization
  -- turns whole shares into fractional ones anyway.
  shares                REAL    NOT NULL,
  price_per_share_cents INTEGER NOT NULL DEFAULT 0,
  -- 1 when shares/price are ALREADY in today's post-split terms (a modern broker
  -- export), 0 when they are the historical figures off an old confirmation and the
  -- split table must be applied. Defaults to 0: the historical case is the one this
  -- feature exists for, and defaulting the other way would silently under-report
  -- shares on exactly those lots.
  is_split_adjusted     INTEGER NOT NULL DEFAULT 0,
  brokerage_firm        TEXT    NOT NULL DEFAULT '',
  note                  TEXT    NOT NULL DEFAULT '',
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The analyzer's only query shape: one ticker's lots, oldest first.
--
-- Deliberately NOT UNIQUE. Per coding-guide.md, a DATE column may never sit in a
-- unique index: buying a position in several lots through one day is completely
-- ordinary, and at date granularity those rows genuinely are identical, so a unique
-- constraint here would silently drop every lot after the first.
CREATE INDEX idx_stk_tax_lots_ticker_date ON stk_tax_lots (ticker, buy_date);
