# Migration 0110: per-ticker monitors

**Date:** 2026-09-23
**Type:** one new table

## What this does

Adds `inv_ticker_monitors` — conditions the reader sets against one holding,
evaluated whenever prices refresh.

| Object | Shape | Notes |
|---|---|---|
| `inv_ticker_monitors` | `id` PK, `ticker`, `monitor_type`, `target_cents`, `target_pct`, `band_pct`, `is_enabled`, `is_triggered`, `last_triggered_at`, `last_message`, timestamps | One row per monitor |
| `idx_ticker_monitors_ticker` | `(ticker)` | Every read is per ticker |
| `inv_ticker_monitors_set_updated_at` | trigger | The module's usual `updated_at` stamp |

Three monitor types, all on unrealized gain/loss:

| `monitor_type` | Reads | Uses |
|---|---|---|
| `gain_near_amount` | Unrealized gain approaching $X | `target_cents` |
| `loss_near_amount` | Unrealized loss approaching $X | `target_cents` |
| `gain_near_pct_of_cost` | Unrealized gain approaching X% of cost basis | `target_pct` |

## Why unrealized gain and not price

A price alert is the obvious thing to build and the less useful one. "NVDA hits
$180" means nothing on its own — whether that is worth knowing depends entirely
on what you paid, and the reader already has that stored. Unrealized gain folds
the two together, which is why all three types are expressed in it.

`loss_near_amount` with a target of `$0` is the case worth calling out: it means
*the bad one has nearly recovered*, which is a genuinely different question from
any gain target and the reason the loss type exists separately rather than being
a negative gain target.

## Two target columns, not one

`target_cents` and `target_pct` both exist on every row, and the unused one
holds 0.

The alternative — one nullable `target_value` that means cents on two types and
a percentage on the third — was rejected because a cents figure and a percentage
are **different units**, and a single column would make every read guess which
it was holding. A SQL Explorer query against this table should be readable
without knowing the evaluator's source. Money is cents throughout this codebase
(`src/lib/shared/money.ts`); percentages are plain floats, as they are on
`inv_stock_positions.unrealized_gain_loss_pct`.

## "Near" is a percentage band, stored per row

`band_pct` (default 5) defines *near*: the value is within that percent of the
target.

A percentage rather than a fixed dollar tolerance because it scales. 5% is a
sensible default against a $500 target and against a $100,000 one, and the same
number reads correctly for the percent-of-cost type where a dollar tolerance
would not apply at all.

Per row rather than one global setting because the right tolerance is a property
of the question: "near $10,000" and "near break-even" want different widths, and
the reader is the one who knows which.

**The `loss_near_amount` $0 case needed its own rule.** 5% of a $0 target is $0,
so a band derived from the target would never fire — the one monitor that most
wants to exist would be the one that could not. For that case the band is taken
against the position's **cost basis** instead: within 5% of cost basis of
break-even. The rule lives in the evaluator (`src/lib/ticker-monitors`) with its
own tests, not in the schema, because it is a statement about what "near" means
rather than about storage.

## The fire-once latch

`is_triggered` is the reason this table holds state rather than being pure
configuration.

A monitor sitting inside its band is true on *every* refresh. Without a latch it
files an identical message each time, and a reader who refreshes hourly finds
forty copies of the same sentence in the queue. So the message is filed on the
**transition** from outside the band to inside it:

| Refresh | Value | Latch | What happens |
|---|---|---|---|
| 1 | enters band | `0` → `1` | Message filed, warning icon shows |
| 2 | still in band | `1` | Icon stays, nothing filed |
| 3 | leaves band | `1` → `0` | Re-armed |
| 4 | re-enters | `0` → `1` | New message filed |

The warning icon is derived live from the current evaluation, not read from
`is_triggered` — the icon answers "is this true now", the latch answers "have we
already said so". Keeping them separate is what lets the icon disappear the
moment a value leaves the band without also suppressing the next message.

`last_message` stores the sentence as filed, so the ticker's warning modal can
show what was said without re-deriving it from figures that have since moved.

## Not unique on `(ticker, monitor_type)`

Two gain targets on one holding is an ordinary thing to want — *tell me at
$5,000, and again at $10,000*. A unique index would silently make the second
one impossible.

This follows the general rule recorded in `coding-guide.md` under *Never put a
DATE column in a unique index*: a unique index may only span columns that
identify the row exactly. `(ticker, monitor_type)` does not identify a monitor;
only the `id` does.

## Household-wide

No `user_id`, matching `sys_messages` (0109) and the holdings these watch. A
monitor is a fact about a shared position, and any reader's refresh fires it.
The defence of that choice, and the shape to move to if it ever stops holding,
is written up in 0109 — the same reasoning covers both tables.
