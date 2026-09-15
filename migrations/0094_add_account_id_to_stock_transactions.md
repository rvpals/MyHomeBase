# Migration 0094: which account a transaction belongs to

**Date:** 2026-09-14
**Type:** additive column + index + conditional backfill
**Table(s) affected:** `stk_stock_transactions`

## What this does

| Column | Type | Notes |
|---|---|---|
| `account_id` | `INTEGER NOT NULL DEFAULT 0` | Which `stk_investment_accounts` row the trade belongs to. `0` = Unassigned, matching `stk_stock_positions.account_id`. |

Plus `idx_stock_transactions_account` on `(account_id)`, so filtering a ticker's
trades to one account is cheap.

## The bug this fixes

A position is keyed `(account_id, ticker)`. A transaction carried no account at all —
only the free-text `brokerage_firm` from 0038. So the opt-in "also update positions
data" path had to *infer* which holding a trade moved, and `resolveTargetPosition`
did it by counting holdings of that ticker:

- 0 holders → refuse (fine)
- 2+ holders → ask the user (fine)
- **1 holder → assume it's the right one** ← the bug

That last branch is wrong whenever the trade happened somewhere else. Hold BMY in
Chase only, buy 10 BMY at Fidelity, tick the box: the 10 shares were added to
**Chase**. Silently — no prompt, no warning, a successful save. Fidelity stayed empty
and Chase read 110 shares against a real 100.

The `brokerage_firm` string that would have contradicted the assumption was sitting
on the same form and was never consulted: it was not a parameter to
`resolveTargetPosition`, and nothing compared it against `stk_investment_accounts`.
A sell was worse — it decremented the wrong account, or raised an `OversellError`
naming an account the user never traded in.

"One candidate" was being treated as "no ambiguity". Those are different: one
candidate means *one position exists*, not *this trade belongs to it*.

## Why `account_id` **and** `brokerage_firm`, not a replacement

Migration 0038 argued against a foreign key, and that reasoning still holds — so this
column is a **plain integer with no `REFERENCES` clause**, and 0038's column stays:

- The firm a trade executed at is a fact about a historical event. It must survive
  the account being renamed, closed, or deleted.
- Broker CSV exports name a firm as text, not an id, and may name a firm you no
  longer hold an account with.
- `brokerage_firm` is the CSV importer's alias target (`Brokerage`, `Broker`,
  `Brokerage Firm`, `Firm`), and dropping it would lose data for every row whose
  string matches no account.

So: `brokerage_firm` is what the broker called it, `account_id` is which of *your*
accounts it belongs to. The first is history and can go stale; the second is a live
link the apply-to-position logic can trust. No FK means deleting an account leaves
orphaned ids reading as Unassigned rather than failing the delete — the same
tolerance `stk_stock_positions` already has.

## Data handling

The backfill sets `account_id` only where `trim(brokerage_firm)` already matches an
account's `name`, compared case-insensitively and whitespace-trimmed. So `"chase"`,
`"Chase"` and `" Chase "` all resolve to the Chase account.

Everything else keeps `0` (Unassigned). Deliberately: a string like
`"Fidelity Investments"` against an account named `"Fidelity"` is *probably* the same
thing, but guessing is exactly the class of error this migration exists to remove.
Those rows are re-assignable from the Transactions screen.

Rows with an empty `brokerage_firm` are untouched by the `UPDATE` — they were never
attributed and still aren't.

The subquery can only match one account unless two accounts share a name
case-insensitively; if that ever happens SQLite takes one arbitrarily, which is why
the app should keep account names distinct. Worth checking before running:

```sql
SELECT lower(trim(name)), count(*) FROM stk_investment_accounts
GROUP BY 1 HAVING count(*) > 1;
```

## Rollback

```sql
DROP INDEX idx_stock_transactions_account;
ALTER TABLE stk_stock_transactions DROP COLUMN account_id;
```

Safe and lossless — `brokerage_firm` was never modified, so every row keeps the
attribution it had before this migration.
