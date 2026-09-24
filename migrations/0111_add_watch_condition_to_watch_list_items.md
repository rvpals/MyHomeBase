# Migration 0111: a watch condition on a watch-list row

**Date:** 2026-09-23
**Type:** six new columns + one partial index on an existing table

## What this does

Adds an optional *watch* to `inv_stock_watch_list_items` — "tell me when this
ticker does X" — evaluated whenever prices refresh.

| Column | Type | Notes |
|---|---|---|
| `watch_kind` | `TEXT NOT NULL DEFAULT ''` | `''` = not watching. Six kinds below. |
| `watch_value` | `REAL NOT NULL DEFAULT 0` | Cents or percent, per kind |
| `watch_value_high` | `REAL NOT NULL DEFAULT 0` | Only `price_range` reads it |
| `watch_is_triggered` | `INTEGER NOT NULL DEFAULT 0` | The fire-once latch |
| `watch_last_triggered_at` | `TEXT` | Also the event cursor for dividend/split |
| `watch_last_message` | `TEXT NOT NULL DEFAULT ''` | The sentence as filed |
| `idx_watch_list_items_watch_kind` | partial index | `WHERE watch_kind <> ''` |

The six kinds — these are **storage values**, so renaming one orphans every
existing row:

| `watch_kind` | `watch_value` means | Fires when |
|---|---|---|
| `price` | Target price, cents | The live price reaches it, from either side |
| `price_range` | Low bound, cents (`watch_value_high` = high) | The live price sits inside the range |
| `dividend` | *unread* | A dividend is issued after the row was added |
| `split` | *unread* | A split happens after the row was added |
| `gain_loss_pct` | Percent, e.g. `20` | The price has swung ±20% since added |
| `gain_loss_price` | Cents, e.g. `$10` | The price has swung ±$10/share since added |

## Why this is not a row in `inv_ticker_monitors`

0110 added per-ticker monitors a day earlier, and the overlap is real enough to
be worth writing down rather than discovering later.

`inv_ticker_monitors` watches **unrealized gain or loss on a position you
actually hold**. Its log argues — correctly, for that case — that a price alert
is the obvious thing to build and the less useful one, because "NVDA hits $180"
means nothing without knowing what you paid.

**A watch-list row is the case where that argument does not apply.** It is a
ticker you are *considering*. There is no cost basis, because you own none of
it, so unrealized gain is undefined and a price target is the only thing there
is to watch. The two features answer different questions about different things,
and the reader reaches them from different screens.

So the condition lives on the item: it belongs to that list entry, it is created
and deleted with it, and removing a ticker from a watch list should not leave an
orphaned monitor firing about a stock nobody is tracking any more. A nullable
`watch_list_item_id` on the monitors table would have bought one evaluator at
the cost of a table where half the columns are unread on half the rows.

What *is* shared is the shape: the latch below is 0110's, deliberately, and the
evaluator is a pure function with its own tests for the same reason.

## The baseline for the swing kinds is the price when added

`gain_loss_pct` and `gain_loss_price` measure against
`price_when_added_cents`, which `0017` has snapshotted since the table existed.

Not cost basis — there is none. Not the previous close — that would make "20%"
mean a one-day move, which is not what a watch list is for. The price when you
added it is the figure the reader has in mind when they say "tell me if it
swings 20%", because adding the row is the moment they started caring.

Both are **symmetric**: ±20% fires on the way up and on the way down, which is
what "gain or loss" asks for. The message says which way it went.

A row whose `price_when_added_cents` is 0 (the quote failed when it was added)
cannot evaluate either kind, and is skipped rather than treated as a 100% gain.

## `price` fires from either direction

"Price hits $100" fires whether the price rose to $100 or fell to it. A watch
list holds tickers you are waiting on, and waiting for a fall is at least as
common as waiting for a rise — reading the target as "reaches or passes, from
wherever it was" is the only reading that serves both without a second field.

The crossing is detected by the latch, not by comparing against a stored
previous price: the condition is "the price is at or through the target", and
the latch turns that into one message per crossing.

## Dividend and split latch on the event date, not on a band

The other four kinds are continuous — a price is inside a range or it is not, so
leaving the range re-arms them.

A dividend is not continuous. It is a dated fact that stays true forever, so
"has this ticker paid a dividend" would fire once and then never re-arm, and the
next quarter's dividend would be swallowed by the last one's latch.

So for these two kinds `watch_last_triggered_at` doubles as an **event cursor**:
the row fires for the newest event dated **after** both `added_date` and the
cursor, then stores that event's date. The next dividend is newer than the
cursor, so it fires again. `added_date` is the floor, which is what stops adding
a row to a watch list from immediately announcing last quarter's dividend as
though it were news.

## Events are fetched on the scheduled pass only

`dividend` and `split` need `MarketEventsClient.getEvents`, which is one network
call **per ticker** on top of the quote the refresh already makes.

The manual *Refresh All* button skips them; the timed pass runs them. A reader
pressing the button is watching a status line and wants prices back, and a
dividend that lands four hours later is exactly the kind of thing the message
queue exists for. The four price-based kinds run on both paths, because they
cost nothing beyond the quote already fetched.

This means a dividend watch is only as timely as the auto-refresh interval, and
does nothing at all if auto-refresh is off. That is a deliberate trade and the
first thing to revisit if it proves wrong.

## One watch per row

A single condition per list entry, not a child table.

Two watches on one ticker is a thing somebody might want, and 0110 explicitly
allowed it for monitors. Here it would mean a second table to add a field the
request describes as "an optional field" on the add form. If it turns out to be
wanted, the move is a child table keyed on `watch_list_item_id`, and these
columns migrate into it as its first row per item.

## One value column, not one per unit

0110 used `target_cents` and `target_pct` side by side so a SQL Explorer reader
never has to guess the unit, and that was right for three kinds.

It does not scale to six. Three kinds read cents, one reads a percent, two read
nothing, and one reads a pair — a column per unit leaves most rows holding four
zeroes. So `watch_value` is a `REAL` and `watch_kind` states how to read it.

`REAL` rather than `INTEGER` because `gain_loss_pct` is genuinely fractional
(a 2.5% swing is a reasonable thing to watch). The cents kinds still store whole
numbers and the domain type rounds them on the way out, so money remains cents
everywhere it is used (`src/lib/shared/money.ts`).

## Household-wide

No `user_id`, matching the watch lists themselves (0017), `sys_messages` (0109)
and `inv_ticker_monitors` (0110). A watch list is shared, so a watch on one of
its rows is too, and any reader's refresh fires it.
