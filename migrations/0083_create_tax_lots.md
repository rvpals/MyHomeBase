# Migration 0083: tax lots for the Tax Lot Portfolio Analyzer

**Date:** 2026-09-06
**Type:** new table

## What this does

Adds `stk_tax_lots`, one row per historical purchase of a ticker. The Stocks &
ETFs module gains a *Tax Lots* section that normalizes each lot for corporate
splits, scores it against the current market price, and reports the position's
money-weighted return (XIRR), blended cost basis, and which lots have crossed
the one-year long-term capital-gains line.

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PK AUTOINCREMENT` | |
| `ticker` | `TEXT NOT NULL` | Uppercased at the schema boundary |
| `buy_date` | `TEXT NOT NULL` | ISO `YYYY-MM-DD`. A date, not a timestamp |
| `shares` | `REAL NOT NULL` | Fractional — see below |
| `price_per_share_cents` | `INTEGER NOT NULL DEFAULT 0` | Integer cents, as every money column |
| `is_split_adjusted` | `INTEGER NOT NULL DEFAULT 0` | `1` = already post-split |
| `brokerage_firm` | `TEXT NOT NULL DEFAULT ''` | Blank, never NULL |
| `note` | `TEXT NOT NULL DEFAULT ''` | |
| `created_at` / `updated_at` | `TEXT NOT NULL` | `datetime('now')` |

Plus `idx_stk_tax_lots_ticker_date` on `(ticker, buy_date)`.

## Why a new table rather than reusing `stk_stock_transactions`

The two record different things. A transaction is **what the broker did** — a
Buy or a Sell, with a reference number, immutable history. A tax lot is **what
you still hold**, and it needs one field a transaction has no business carrying:
whether its share count is expressed in pre- or post-split terms.

Bolting `is_split_adjusted` onto `stk_stock_transactions` would put a field that
only means something for open Buy lots onto every Sell row too, and would mean
the analyzer either reinterpreting sell history it does not model yet, or
filtering it out on every read. Deriving lots from transactions is the better
long-term model, but it requires a sell-allocation policy (FIFO, LIFO, specific
identification) that this feature does not implement. Keeping the tables
separate is the honest version of what is actually built; a later migration can
backfill lots from Buy transactions once a policy exists.

## Why `shares` is REAL

Two reasons, either sufficient. Fractional share purchases are ordinary at every
broker now. And normalization multiplies by a cumulative split factor — a 2019
NVDA lot of 10 shares becomes 400 after a 4:1 and a 10:1, but a lot of 3 shares
through a reverse split becomes a fraction. An INTEGER column would round the
cost basis away.

## Why nothing is UNIQUE on `buy_date`

`coding-guide.md` → *Never put a DATE column in a unique index*. Buying a
position in several lots through one day is completely ordinary, and at date
granularity those rows genuinely are identical on every column — so no
combination of columns can separate them, and a unique constraint would silently
reject every lot after the first. This is the same trap
`stk_stock_transactions` fell into (worked through in migration 0038); the index
here exists for lookups only.

There is deliberately no duplicate detection at the database level. A lot is
entered by hand on a form that shows the existing lots, so the user can see what
is already there — unlike a CSV re-import, there is no bulk path that could
silently double a position.

## Why `is_split_adjusted` defaults to 0

`0` means "these are the historical figures off the old confirmation, apply the
split table". That is the case the feature exists for, and it is the safer
default: applying the table to already-adjusted numbers over-reports shares
loudly and obviously (400 shares becoming 16,000), whereas failing to apply it
under-reports quietly and looks plausible.

## Rollback

`DROP TABLE stk_tax_lots;` — no other table references it, and nothing else
reads it.
