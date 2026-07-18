# Migration 0016: create stock_positions and stock_transactions

**Date:** 2026-07-17
**Type:** new tables

## What this does

Core holdings and trade-log tables for the Stocks & ETFs module, ported from
the InvestHelp PWA's `investment_positions`/`investment_transactions`.

## `stock_positions`

| Column | Type | Notes |
|---|---|---|
| `ticker` | `TEXT PRIMARY KEY` | natural key, e.g. `AAPL` — kept as the PK like the source app, no synthetic `id` |
| `name` | `TEXT NOT NULL DEFAULT ''` | company/fund name |
| `type` | `TEXT NOT NULL DEFAULT 'Stock'` | one of `Stock`/`ETF`/`Bond`/`MutualFund`/`Crypto`/`Other`; enforced by the module's zod schema, not a DB `CHECK` (matches this project's existing convention of validating at the boundary, not the schema) |
| `current_price_cents` | `INTEGER NOT NULL DEFAULT 0` | money as integer cents |
| `quantity` | `REAL NOT NULL DEFAULT 0` | fractional shares allowed |
| `day_gain_loss_cents` | `INTEGER NOT NULL DEFAULT 0` | |
| `value_cents` | `INTEGER NOT NULL DEFAULT 0` | `current_price_cents * quantity`, kept as a stored field (see denormalization note) |
| `day_high_cents` / `day_low_cents` | `INTEGER NOT NULL DEFAULT 0` | |
| `dividend_rate_cents` | `INTEGER NOT NULL DEFAULT 0` | annual dividend per share |
| `created_at` / `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `updated_at` trigger-maintained |

Ticker logo images (`logo BLOB` in the source) are dropped for this pass —
out of scope per the port plan.

## `stock_transactions`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | internal PK |
| `transaction_at` | `TEXT NOT NULL` | ISO datetime; source split this into separate `date`/`time` epoch-int columns — consolidated into one field to match this app's date convention |
| `action` | `TEXT NOT NULL DEFAULT 'Buy'` | `Buy` or `Sell`, validated by the zod schema |
| `ticker` | `TEXT NOT NULL` | no FK to `stock_positions` (project convention) — a transaction can reference a ticker that was later deleted from positions, same as the source app allowed |
| `number_of_shares` | `REAL NOT NULL DEFAULT 0` | |
| `price_per_share_cents` | `INTEGER NOT NULL DEFAULT 0` | |
| `total_amount_cents` | `INTEGER NOT NULL DEFAULT 0` | |
| `note` | `TEXT NOT NULL DEFAULT ''` | |
| `created_at` / `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `updated_at` trigger-maintained |

`idx_stock_transactions_unique` on `(transaction_at, action, ticker,
total_amount_cents)` — carried over from the source's duplicate-prevention
index. `idx_stock_transactions_ticker` — the "all transactions for this
ticker" query pattern (stats, transaction list, unrealized-gain calc).

## Denormalization flag

`stock_positions.quantity`/`current_price_cents`/`value_cents` are manually
maintained (via the position form and price refresh), **not derived** from
summing `stock_transactions`. This mirrors the source app's model exactly —
see the "Flagged design call" in the module's plan. Approved by Min as a
faithful port rather than a redesign; can be revisited later if the
duplication causes real drift between the trade log and reported holdings.

## No seed data

Both tables start empty.

## Rollback

```sql
DROP TABLE stock_transactions;
DROP TABLE stock_positions;
```
