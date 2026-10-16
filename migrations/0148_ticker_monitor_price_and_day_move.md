# Migration 0148: price targets and day-move ticker monitors

**Date:** 2026-10-14
**Type:** new column (1) on an existing table

## What this does

Adds two values to `inv_ticker_monitors.monitor_type` and one column to carry the
parameter the second of them needs.

| Column | Type | Notes |
|---|---|---|
| `direction` | `TEXT NOT NULL DEFAULT ''` | `'up'` / `'down'` for `day_move_pct`; `''` for every other type |

The two new `monitor_type` values:

| Value | Reads | Means |
|---|---|---|
| `price_near_amount` | `target_cents`, `band_pct` | Price per share is within `band_pct` of `$target` |
| `day_move_pct` | `target_pct`, `direction` | Price moved `target_pct`% or more against the previous close, in `direction` |

No new table. Existing rows are untouched — they take the column default and none of
the three original types ever reads it.

## The problem it solves

0110's three monitors are all about unrealized gain or loss, and its header states the
reasoning plainly: *"a price target means nothing without knowing what you paid."*

That is true of a decision about **this holding** and too narrow for a decision about
**this security**. Two questions it cannot express:

- *"Tell me when BMY gets back to $45."* A price the reader is waiting for — to buy
  more, to sell, or because it is the number they have in their head. The cost basis is
  not part of the question.
- *"Tell me when it moves 3% in a day."* A volatility signal. A holding can drop 3%
  today and still be up 40% on the basis, so no gain/loss monitor fires, and the thing
  the reader wanted to know about has gone unreported.

Both figures were already on screen and neither could be watched.

## Neither needs a new quote field

The point worth recording, because it is what kept this to one column.

`price_near_amount` reads `inv_stock_positions.current_price_cents` directly.

`day_move_pct` needs a session baseline, and the previous close falls out of what
`refreshPosition` already stores ([stock-positions.ts](../src/lib/stock-positions/stock-positions.ts)):

```
day_gain_loss_cents = (price - previousClose) * quantity
  =>  previousClosePerShare = price - (day_gain_loss_cents / quantity)
```

So: no price-history table, no new `MarketDataClient` field, no extra API call, nothing
paid or metered.

### What that baseline does and does not mean

It is **previous close**, so the figure is "today's % change" as every quote site uses
the phrase — measured from yesterday's close, not from today's open. The open is not
stored (`day_high_cents` and `day_low_cents` are; the open is not), and adding it would
have meant a schema change plus a feed field to verify. Confirmed as the intended
reading before building.

Two consequences, both accepted:

- **It is only as fresh as the last refresh.** A move that happens and reverses between
  two refreshes is never seen. Monitors run on refresh by construction (0110), so this
  is inherent rather than a gap in this migration.
- **`quantity = 0` has no derivable baseline.** Those positions are skipped rather than
  dividing by zero. The price target still works on them.

## `direction` is a column, not two monitor types

`'day_move_up'` and `'day_move_down'` would have been one fewer column and would have
duplicated every case that handles the type — in the evaluator, the summary, the
sentence and the schema. The direction is a *parameter* of the condition in the same
way the target is. `monitor_type` stays "what is watched"; `direction` is "which way".

`target_pct` is **always positive** and the direction carries the sign: "down 3%" is
`target_pct 3` + `direction 'down'`, never `-3`. This mirrors `loss_near_amount` storing
a positive figure for a negative quantity, and for the identical reason 0110 gives —
one condition must not have two spellings.

## `price_near_amount` uses the band; `day_move_pct` does not

`price_near_amount` reuses the existing band rule unchanged, which was a deliberate
choice to keep one "near" meaning across every type that has a target.

**It therefore fires on approach from either side.** $150 within 5% is true anywhere
from $142.50 to $157.50, climbing or falling, and stays latched until the price leaves
that range entirely. It cannot express "when it finally hits $150 and not before"; a
tight band (0.5%) is how to ask for something close to a crossing. Recorded here
because it is the one behaviour of these two that will read as a bug later if the
reasoning is not written down.

`day_move_pct` **ignores `band_pct`**, and the setup screen hides the field for it. A
band around a move threshold is nonsense: 5% either side of a 3% target is true from
-2% to +8%, which is always. It is a threshold — fire at 3% or beyond.

## The cost-basis guard is now per-type

`evaluateMonitor` refused to judge *any* monitor when `cost_cents <= 0`, because every
0110 type is measured against money actually put in.

A price target and a day move are facts about the security, so that guard became
per-type. The three gain/loss types keep it exactly as before; the two new ones run on
a holding with no imported transactions. Without this, a watch-list position would
accept a price monitor and then silently never fire it — the inert-monitor failure mode
0110's schema comments call the worst one for an alert.

## Reversal

```sql
DELETE FROM inv_ticker_monitors
 WHERE monitor_type IN ('price_near_amount', 'day_move_pct');
ALTER TABLE inv_ticker_monitors DROP COLUMN direction;
```

In that order. Dropping the column alone would leave `day_move_pct` rows that no longer
know which way they watch. Rows of the original three types are unaffected either way.
