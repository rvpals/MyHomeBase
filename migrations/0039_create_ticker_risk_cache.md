# Migration 0039: create stk_ticker_risk_cache

**Date:** 2026-08-06
**Type:** new table

## What this does

Stores the risk figures for one ticker so the ticker viewer's **Risks** card can
render from the database instead of recomputing on every open.

Before this, `getTickerRisk()` made **two** provider round-trips every single
time the card was shown — a year of daily closes for the ticker, plus a year for
the `SPY` benchmark to get the correlation. Nothing was kept. Reopening the same
ticker three times in a morning paid for it three times.

| Column | Type | Notes |
|---|---|---|
| `ticker` | `TEXT PRIMARY KEY` | upper-cased by the use-case's zod schema |
| `annualized_vol_pct` | `REAL NOT NULL DEFAULT 0` | |
| `daily_std_dev_pct` | `REAL NOT NULL DEFAULT 0` | |
| `volatility_label` | `TEXT NOT NULL DEFAULT ''` | Low / Moderate / High / Very High |
| `low_52w_cents` | `INTEGER NOT NULL DEFAULT 0` | |
| `high_52w_cents` | `INTEGER NOT NULL DEFAULT 0` | |
| `current_price_cents` | `INTEGER NOT NULL DEFAULT 0` | last close in the window, not a live quote |
| `range_position_pct` | `REAL NOT NULL DEFAULT 0` | 0-100 up the 52-week range |
| `market_correlation` | `REAL` (nullable) | **NULL = benchmark unavailable** |
| `market_benchmark_ticker` | `TEXT NOT NULL DEFAULT ''` | `SPY` today; stored so an old row still says what it was measured against |
| `annualized_return_pct` | `REAL NOT NULL DEFAULT 0` | |
| `sample_count` | `INTEGER NOT NULL DEFAULT 0` | closes the figures came from |
| `calculated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | surfaced in the UI — see below |

No index beyond the primary key: every read is by exact ticker.

## Why not reuse `stk_stock_volatility_cache`

That table (migration 0018) already holds vol, std dev, the label, the 52-week
range, range position and sample count, so reusing it is the obvious first idea.
Three things rule it out:

1. **It is refreshed wholesale.** `SqliteStockAnalyticsRepository.clearVolatilityCache()`
   does `DELETE FROM stk_stock_volatility_cache` and the analytics dashboard then
   re-saves every row. A per-ticker write from the viewer would be silently
   discarded the next time anyone hit "Refresh All" on that dashboard.
2. **It is position-shaped.** It carries `shares`, `company_name` and `type`,
   which describe a *holding*. The ticker viewer opens for watchlist-only and
   entirely unheld symbols, which have no shares to record.
3. **It is missing two of the card's four headline figures** — there is no
   correlation column and no annualized return.

The two caches overlap in content but not in owner, lifecycle or key set.
Converging them means reworking the analytics module's refresh, which is a
separate job.

## Staleness: none, by design

A stored row is served **however old it is**. There is no TTL and no automatic
recompute. The only thing that refetches is the **Recalculate** button in the
Risks card header, which calls the same use-case with `refresh: true`.

This was a deliberate choice over a 24-hour TTL: it makes provider traffic fully
predictable — nothing hits the network unless a reader asks for it. The cost is
that a number can be arbitrarily old, so the card always prints
`Calculated <date>` and turns that line amber once the row is more than seven
days old. The age is never hidden.

Note the consequence for `current_price_cents` and `range_position_pct`: they are
snapshots from calculation time, not live. That is why the card's headline price
still comes from the Quote card, which is fetched fresh.

## Failure behaviour

A failed recalculation **leaves the stored row in place**. The card keeps showing
the old figures with their original `calculated_at` and surfaces the error
separately, rather than blanking a perfectly readable answer because the network
was down for a moment. A first-ever calculation with no row to fall back on
propagates the error as before.

## Rollback

```sql
DROP TABLE stk_ticker_risk_cache;
```

Dropping it only discards the cache; the figures are recomputed on next view.
