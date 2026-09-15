-- Migration 0094: which account a transaction belongs to.
--
-- `brokerage_firm` (0038) records the firm as free text and is kept as-is — it is the
-- historical record and the CSV importer's alias target. This adds the structured
-- link the apply-to-position path needs. See the .md log for why both columns exist.

ALTER TABLE stk_stock_transactions ADD COLUMN account_id INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_stock_transactions_account
  ON stk_stock_transactions (account_id);

-- Backfill only where the recorded firm string already names an account, matched
-- case-insensitively and ignoring surrounding whitespace. Anything else keeps 0
-- (Unassigned) rather than being guessed at.
UPDATE stk_stock_transactions
SET account_id = (
  SELECT id FROM stk_investment_accounts
  WHERE lower(trim(name)) = lower(trim(stk_stock_transactions.brokerage_firm))
)
WHERE trim(brokerage_firm) <> ''
  AND EXISTS (
    SELECT 1 FROM stk_investment_accounts
    WHERE lower(trim(name)) = lower(trim(stk_stock_transactions.brokerage_firm))
  );
