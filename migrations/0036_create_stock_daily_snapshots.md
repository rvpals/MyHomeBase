# Migration 0036: daily portfolio snapshots

**Date:** 2026-08-04
**Type:** new table
**Table(s) affected:** `stk_daily_snapshots` (new)

## What this does

Records what the portfolio was worth at the end of each day, split by instrument
type, so the module can chart a value history and report week- and month-to-date
performance. Written by the Refresh All button on the Stocks & ETFs dashboard.

| Column | Type | Notes |
|---|---|---|
| `snapshot_date` | `TEXT PRIMARY KEY` | Local-calendar `YYYY-MM-DD`. See "One row per day". |
| `stock_value_cents` | `INTEGER NOT NULL DEFAULT 0` | Σ shares × current price, for `type = 'Stock'`. |
| `etf_value_cents` | `INTEGER NOT NULL DEFAULT 0` | Same, for `type = 'ETF'`. |
| `other_value_cents` | `INTEGER NOT NULL DEFAULT 0` | Everything else — Bond, MutualFund, Crypto, Other. |
| `total_value_cents` | `INTEGER NOT NULL DEFAULT 0` | The three above, summed. |
| `stock_gain_loss_cents` | `INTEGER NOT NULL DEFAULT 0` | Signed. Σ shares × (price − previous close). |
| `etf_gain_loss_cents` | `INTEGER NOT NULL DEFAULT 0` | Signed. |
| `other_gain_loss_cents` | `INTEGER NOT NULL DEFAULT 0` | Signed. |
| `total_gain_loss_cents` | `INTEGER NOT NULL DEFAULT 0` | Signed; the three above, summed. |
| `position_count` | `INTEGER NOT NULL DEFAULT 0` | How many positions the row was computed from. |

## Why "other" is stored, not just stock and ETF

So the parts sum to the total. The portfolio holds non-equity lines — a Chase
export includes a money-market sweep — and storing only stock + ETF would leave
`total` unequal to its components, quietly breaking any chart stacked from them.

## Why both value and gain/loss

They answer different questions and neither derives correctly from the other.

- **Value** gives the equity curve, but differencing two days' values is *not*
  performance: buy $10k of stock on Wednesday and the diff shows a $10k "gain".
- **Gain/loss** is the day's mark-to-market move (price change × shares held that
  day), which excludes contributions and is therefore the honest performance
  number. But it can't be reconstructed from stored values for exactly the reason
  above.

Capturing both costs nothing — one refresh pass produces both — and week/month
rollups sum the gain/loss column rather than differencing values.

## One row per day, upserted

`snapshot_date` is the primary key and captures use
`INSERT … ON CONFLICT (snapshot_date) DO UPDATE`. Pressing Refresh All a second
time on the same day recomputes and overwrites that day; the first press of a new
day inserts. That makes the button idempotent per day, which is what lets it double
as "bring today up to date" without the user having to think about it.

The date is the **local** calendar day (`todayIsoLocal` in `src/lib/shared/date.ts`),
not a UTC slice of the timestamp — a UTC date would file an evening refresh under
tomorrow for any negative-offset timezone.

## What this deliberately does not do

- **No back-fill.** The table starts empty and gains a row per day from the first
  refresh onward. Historical values can't be reconstructed: the app stores only
  each position's *current* price, not a per-day price series for the tickers held
  on that day.
- **No gap-filling.** A day with no refresh has no row, and the period rollups
  report the day count they actually had (`"MTD +$4,200 over 18 days"`) rather than
  inventing a flat day. A missing day should be visible, not smoothed over.
- **No index beyond the primary key.** Every query is either "one date" or "a date
  range ordered by date", both of which ride the primary key. At one row per day the
  table gains ~250 rows a year.

## Rollback

```sql
DROP TRIGGER stock_daily_snapshots_set_updated_at;
DROP TABLE stk_daily_snapshots;
```
