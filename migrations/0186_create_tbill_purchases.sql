-- Investments: US Treasury Bill purchases, for the T-Bill section.
--
-- Separate from inv_stock_positions and inv_tax_lots on purpose (see the .md log).
-- A T-Bill is not a holding that is marked to market and not a lot that is split
-- adjusted: it is bought at a discount, held to a known maturity date, and redeemed
-- at face value. Its whole lifecycle is known the day it is bought, which is why
-- date_payout and payout_amount_cents are NOT NULL here rather than filled in later.
--
-- Same inv_ prefix: brokerage and per-instrument tables share one namespace.

CREATE TABLE inv_tbill_purchases (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,

  -- The symbol as the broker shows it. Free text, deliberately NOT a foreign key to
  -- inv_stock_positions: a Treasury CUSIP is not a ticker you hold there, and tying
  -- the two would make recording a bill depend on first creating a position for it.
  symbol               TEXT    NOT NULL DEFAULT '',
  -- The broker's own long description of the instrument. Long text, no length cap.
  description          TEXT    NOT NULL DEFAULT '',

  -- ISO YYYY-MM-DD, both of them. Dates, not timestamps -- which is exactly why
  -- nothing here is UNIQUE on one (see the index note below).
  date_purchased       TEXT    NOT NULL,
  date_payout          TEXT    NOT NULL,

  -- REAL, not INTEGER: fractional quantities are ordinary on a Treasury purchase.
  -- Same call inv_tax_lots.shares makes, for the same reason.
  shares_purchased     REAL    NOT NULL DEFAULT 0,

  -- The price per $100 of face value, as the confirmation quotes it (e.g. 98.6375).
  -- REAL rather than cents because this is a QUOTED RATE, not an amount of money:
  -- Treasury prices carry six decimals, and rounding to cents would move the
  -- computed yield in the fourth significant figure. The same split migration 0111
  -- makes for watch conditions -- cents for money, REAL for a rate.
  purchase_price       REAL    NOT NULL DEFAULT 0,

  -- Money, so: integer cents. Stored rather than computed from shares x price
  -- because the broker's settled amount includes rounding the formula does not
  -- reproduce, and gain is defined against what actually left the account.
  amount_spent_cents   INTEGER NOT NULL DEFAULT 0,
  payout_amount_cents  INTEGER NOT NULL DEFAULT 0,

  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- NOTHING IS STORED FOR gain, gain %, days to maturity or yield. All four are
-- derived on read in src/lib/treasury-bills. A stored copy can disagree with the
-- columns it was computed from the moment a row is edited, and there is no query
-- that needs them indexed.

-- The section's only query shape: newest purchase first.
--
-- Deliberately NOT UNIQUE. Per coding-guide.md, a DATE column may never sit in a
-- unique index: buying two bills of the same symbol on one day is ordinary, and at
-- date granularity those rows genuinely are identical, so a unique constraint would
-- silently drop the second. The CSV importer does the duplicate detection instead,
-- where it can see the whole file at once.
CREATE INDEX idx_inv_tbill_purchases_date
  ON inv_tbill_purchases (date_purchased DESC, id DESC);

-- The importer's match key: symbol + purchase date.
CREATE INDEX idx_inv_tbill_purchases_symbol_date
  ON inv_tbill_purchases (symbol, date_purchased);
