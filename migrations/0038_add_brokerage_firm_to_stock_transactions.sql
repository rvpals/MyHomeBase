-- Two changes to how a transaction is identified.
--
-- 1. brokerage_firm records where the trade was executed. Free text rather than a
--    foreign key to stk_investment_accounts: a transaction is a historical event, and
--    the firm it happened at should survive the account being renamed or deleted.
--    Broker exports also carry a firm as a name, not an id.
--
-- 2. external_id holds the broker's own reference/confirmation number when the export
--    supplies one. That is the only thing that identifies a trade exactly.
ALTER TABLE stk_stock_transactions ADD COLUMN brokerage_firm TEXT NOT NULL DEFAULT '';
ALTER TABLE stk_stock_transactions ADD COLUMN external_id TEXT NOT NULL DEFAULT '';

-- The old unique index — (transaction_at, action, ticker, total_amount_cents) — could
-- not survive real trading. transaction_at is a DATE, so buying the same ticker for
-- the same amount twice in one day produced two rows identical on all four columns,
-- and the second was rejected as a duplicate of the first. Those are two real trades.
--
-- Uniqueness now applies only where the broker gave us an id to be unique on. The
-- partial WHERE is what makes that possible: rows with no id are simply not covered.
DROP INDEX idx_stock_transactions_unique;
CREATE UNIQUE INDEX idx_stock_transactions_external_id
  ON stk_stock_transactions (external_id)
  WHERE external_id <> '';

-- Without an external id, duplicate detection moves into the importer, which counts
-- how many identical rows a file holds against how many the table already has and
-- inserts only the shortfall (see importTransactionsFromCsv). This index is what makes
-- that count cheap.
CREATE INDEX idx_stock_transactions_natural_key
  ON stk_stock_transactions (transaction_at, ticker, action);
