# Migration 0018: create stock analytics cache tables

**Date:** 2026-07-17
**Type:** new tables

## What this does

Three cache tables backing the Stocks & ETFs module's analytics tab
(volatility, correlation, Sharpe ratio), ported from the InvestHelp PWA's
`volatility_cache`/`correlation_cache`/`sharpe_ratio_cache`. All three are
recomputed wholesale from live market data on demand — they exist purely to
avoid refetching a year of price history on every screen visit, not as a
source of truth.

## `stock_volatility_cache`

One row per ticker (`ticker TEXT PRIMARY KEY`), replaced wholesale on every
bulk recompute. Money as `*_cents`; `annualized_vol_pct`/`daily_std_dev_pct`/
`range_position_pct` are plain percentages (`REAL`), not currency.

## `stock_correlation_cache` / `stock_sharpe_cache`

Both are **singleton tables** — always exactly one row, `id` pinned to `1`
via `INSERT OR REPLACE`. This mirrors the source app exactly and is called
out with a comment in the SQL: there's one portfolio-wide correlation matrix
and one portfolio-wide Sharpe ratio at a time, not one per ticker.

## Deliberate exception: JSON columns

`tickers_json`/`matrix_json`/`market_correlation_json`/`failed_tickers_json`
(correlation) and `ticker_details_json`/`portfolio_return_series_json`/
`skipped_tickers_json`/`skip_reasons_json` (Sharpe) are JSON blobs, which
project convention normally rejects for structured data. Flagged exception,
same rationale as `property_snapshots.raw_data` (migration 0014): an N×N
correlation matrix and a per-day return series don't have a natural
single-row relational shape, they're recomputed and replaced wholesale (never
partially edited), and normalizing them into child tables would add join
overhead for a cache that exists purely to avoid a network refetch.

## No seed data

All three tables start empty; the analytics tab shows "not yet computed"
until a user requests a calculation.

## Rollback

```sql
DROP TABLE stock_sharpe_cache;
DROP TABLE stock_correlation_cache;
DROP TABLE stock_volatility_cache;
```
