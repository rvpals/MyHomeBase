-- A credit-card account gains the day of the month its statement closes.
--
-- Until now the module knew a transaction's date but nothing about the period a
-- card bills over, so there was no way to group spend the way the card itself
-- does. "August" is not a statement: a card closing on the 28th bills 29 Jul to
-- 28 Aug, and a card closing on the 5th bills a different fortnight of the same
-- calendar month. The period is a property of the card, which is why the column
-- lives here rather than on a transaction.
--
-- The close day is *on* the statement — a purchase on the 28th belongs to the
-- cycle ending that day, and one on the 29th opens the next. A day past the end
-- of a short month is clamped to that month's last day (the 31st becomes 28 Feb),
-- which is how every issuer resolves it; that arithmetic lives in
-- src/lib/expense/billing-cycle.ts, not here.
ALTER TABLE exp_creditcard_accounts ADD COLUMN statement_close_day INTEGER NOT NULL DEFAULT 0;

-- No back-fill, and the default is 0 rather than 28.
--
-- 28 is the right default for a card someone is *adding* — most cards close near
-- the end of the month, so the form offers it — but it would be a lie stored
-- against an existing row, indistinguishable from a day the user had confirmed.
-- 0 means "never set", so the Meta Data screen can mark those cards as needing a
-- day while the cycle view still groups them plausibly: normalizeCloseDay()
-- resolves 0 to the default at read time rather than failing.
--
-- creditCardAccountSchema therefore admits 0 and saveAccountSchema does not —
-- readable on the way out, never writable on the way in.

-- No index. Every read of this column arrives with the account row already in
-- hand, and an account list is a handful of rows.

-- No CHECK constraint on the range either. The 1–31 bound is enforced by
-- saveAccountSchema, which is where this module's invariants live (see
-- ARCHITECTURE.md) — and adding a CHECK to an existing table in SQLite needs the
-- full create-copy-drop rebuild, which is a poor trade for a bound the only
-- writer already applies.
