# Migration 0035: cost basis, identifiers and an owning account on stock positions

**Date:** 2026-08-04
**Type:** table rebuild (primary-key change + additive columns)
**Table(s) affected:** `stk_stock_positions`

## What this does

Two changes to the same table, done in one rebuild:

1. **Positions now belong to an account.** The primary key moves from `ticker`
   alone to `(account_id, ticker)`.
2. **Ten new columns** carry what a brokerage export actually reports and the app
   previously threw away — most importantly cost basis, without which the module
   can only show a day's change and never a total return.

### New columns

| Column | Type | Notes |
|---|---|---|
| `account_id` | `INTEGER NOT NULL DEFAULT 0` | Owning `stk_investment_accounts.id`. `0` means **Unassigned**. |
| `cost_cents` | `INTEGER NOT NULL DEFAULT 0` | Total cost basis for the holding. |
| `unit_cost_cents` | `INTEGER NOT NULL DEFAULT 0` | Average cost per share. |
| `unrealized_gain_loss_cents` | `INTEGER NOT NULL DEFAULT 0` | Signed — a loss is negative. |
| `unrealized_gain_loss_pct` | `REAL NOT NULL DEFAULT 0` | Signed percent, as the broker reports it. |
| `cusip` | `TEXT NOT NULL DEFAULT ''` | 9-character US identifier. |
| `isin` | `TEXT NOT NULL DEFAULT ''` | 12-character international identifier. |
| `asset_class` | `TEXT NOT NULL DEFAULT ''` | Broker's class, e.g. `Equity`, `Cash & Money Market Funds`. |
| `asset_strategy` | `TEXT NOT NULL DEFAULT ''` | Broker's strategy, e.g. `US Large Cap`. A **different axis** from `type`. |
| `est_annual_income_cents` | `INTEGER NOT NULL DEFAULT 0` | Forward-looking annual dividend for the whole holding. |
| `income_earned_cents` | `INTEGER NOT NULL DEFAULT 0` | Income actually received to date. |

`unrealized_gain_loss_pct` is stored rather than derived because a broker's own
number accounts for adjusted basis (wash sales, corporate actions) that
`unrealized / cost` on the stored cents cannot reproduce.

`asset_strategy` is deliberately **not** folded into the existing `type` column.
`type` is the instrument kind (`Stock`/`ETF`/`Bond`/…) and drives the portfolio
summary's split; `asset_strategy` is a cap-size/style bucket. They answer
different questions, so they get different columns.

## Why the primary key changed

`ticker` alone meant one row per symbol for the whole app. Importing a positions
CSV from a second brokerage — or the same one under a different account —
overwrote the first rather than adding to it, silently. `(account_id, ticker)`
makes "75 shares of MSFT at Chase" and "69 shares of MSFT at Fidelity" two rows
that sum, which is what a portfolio is.

`account_id` is a plain `INTEGER` with **no** `FOREIGN KEY` clause, matching
`stk_account_performance_records.account_id` (migration 0015) — this schema
enforces referential integrity in the use-case layer throughout, and adding a
constraint on one table only would be inconsistent without being safer.

**`0` is a real, supported value**, not a dangling reference: it means the holding
hasn't been assigned to an account yet. That keeps "I track positions but haven't
set up accounts" working, which is the state the production database is in today
(4 positions, 0 accounts).

## Why a rebuild and not `ALTER TABLE`

SQLite can add columns in place but cannot change a primary key, so the standard
create-copy-drop-rename is the only route. The `.sql` is one script and the runner
wraps every migration in a transaction (`scripts/migrate.ts`), so a failure part
way through rolls the whole thing back rather than leaving a half-built table.

Order matters inside the script: `stock_positions_set_updated_at` references the
old table, so it is dropped *before* the table and recreated afterwards against
the compound key. This follows `coding-guide.md`, which reserves
`ALTER TABLE … RENAME TO` for pure renames and the copy pattern for
column/constraint changes.

## New index

`idx_stock_positions_ticker` on `(ticker)`. With `account_id` leading the primary
key, a cross-account query ("who holds NVDA") no longer has a usable index prefix.
Per-account listing and single-position lookup still ride the primary key.

The trigger keeps its unprefixed name, the known deviation documented in
`coding-guide.md`.

## Data handling

The 4 existing production rows are copied verbatim with `account_id = 0` and
defaults for the ten new columns. Nothing is backfilled or guessed — a zero cost
basis reads as "unknown", and the UI shows a blank rather than a fabricated 100%
gain. Re-importing a positions CSV fills them in.

## Rollback

Reverse rebuild — dropping columns is not enough, because the primary key has to
go back to `ticker` alone. Rows in accounts other than `0` would collide on
`ticker`, so a rollback must pick a winner per symbol; this keeps the
highest-value row:

```sql
CREATE TABLE stk_stock_positions_rollback (
  ticker              TEXT PRIMARY KEY,
  name                TEXT    NOT NULL DEFAULT '',
  type                TEXT    NOT NULL DEFAULT 'Stock',
  current_price_cents INTEGER NOT NULL DEFAULT 0,
  quantity            REAL    NOT NULL DEFAULT 0,
  day_gain_loss_cents INTEGER NOT NULL DEFAULT 0,
  value_cents         INTEGER NOT NULL DEFAULT 0,
  day_high_cents      INTEGER NOT NULL DEFAULT 0,
  day_low_cents       INTEGER NOT NULL DEFAULT 0,
  dividend_rate_cents INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO stk_stock_positions_rollback
SELECT ticker, name, type, current_price_cents, quantity, day_gain_loss_cents,
       value_cents, day_high_cents, day_low_cents, dividend_rate_cents,
       created_at, updated_at
FROM stk_stock_positions
GROUP BY ticker
HAVING value_cents = MAX(value_cents);

DROP TRIGGER stock_positions_set_updated_at;
DROP INDEX idx_stock_positions_ticker;
DROP TABLE stk_stock_positions;
ALTER TABLE stk_stock_positions_rollback RENAME TO stk_stock_positions;

CREATE TRIGGER stock_positions_set_updated_at
AFTER UPDATE ON stk_stock_positions
FOR EACH ROW
BEGIN
  UPDATE stk_stock_positions SET updated_at = datetime('now') WHERE ticker = old.ticker;
END;
```
