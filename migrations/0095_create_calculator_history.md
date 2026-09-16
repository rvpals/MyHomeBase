# Migration 0095: the Floating Calculator's history tape

**Date:** 2026-09-15
**Type:** new table (1)

## What this does

Adds the tape behind the **Floating Calculator** — the second floating component, after
the Floating Clock. One row per completed calculation, per person, capped at the newest
50 each.

| Table | What it holds |
|---|---|
| `sys_calculator_history` | One completed calculation: the expression, the result as displayed, and when |

### `sys_calculator_history`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PK AUTOINCREMENT` | Also the sort key — see below |
| `user_id` | `INTEGER NOT NULL` | → `sys_users.id`. No DB-level FK, per convention |
| `expression` | `TEXT NOT NULL` | As typed, e.g. `3 + sin(45)`. Capped at 500 chars at the boundary |
| `result` | `TEXT NOT NULL` | The **formatted string**, not a number — see below |
| `created_at` | `TEXT NOT NULL` | `datetime('now')` |

Plus `idx_sys_calculator_history_recent` on `(user_id, id DESC)`.

## Why `sys_` and not a new three-letter prefix

`coding-guide.md` prescribes `sys_` for a **platform / cross-cutting** table, and a
floating component is platform furniture: it is available on every page and belongs to no
feature module, exactly like `sys_user_preferences` and `ico_slot_overrides`.

A `clc_` namespace was considered and rejected. History is the calculator's *entire*
domain — there is no second table it will ever gain — so the prefix would be a namespace
with nothing to put in it. That is the mistake the guide names explicitly when it explains
why the Picture Gallery's prefix is `pho_` (the module's domain) and not `alb_` (the first
table that happened to need one): **a prefix is a namespace, so it has to still fit the
second table.** There isn't one here.

## Why per-user, when `gam_scores` is shared

A high-score board is *meant* to be seen by the household — being shared is what makes it
a board. A calculator tape is private working-out. What someone was adding up is nobody
else's business, and two people using the app at once must not see each other's sums
interleaved in one list.

So `user_id` is part of every query's identity, and
[`CalculatorHistoryRepository`](../src/lib/calculator/ports.ts) deliberately exposes **no
method that reads across users** — there is no `listAll`, so a screen cannot accidentally
render someone else's tape.

## Why the result is a string, not a REAL

This is the load-bearing decision in the table.

The tape records **what the reader saw.** Storing `0.30000000000000004` as a `REAL` and
re-formatting it on every read would mean that a later change to the display precision
silently *rewrote history*: an entry that read `0.3` when it was calculated would start
reading something else. Storing the formatted string freezes it at the value that was
actually on screen.

Nothing arithmetic is ever done with this column. It is display data, and typing it as
`TEXT` is what keeps that honest — there is no code path that could treat a tape entry as
a number and reintroduce the rounding question.

## Why `id DESC` and not `created_at DESC`

Not interchangeable here. `datetime('now')` has **one-second resolution**, so several
calculations made in the same second carry an identical timestamp and would come back in
an arbitrary order.

That matters more than it looks, because the 50-row prune runs on **every insert**: with
ties in the ordering, the prune could drop the row that was just written instead of the
oldest one. `id` is monotonic and unambiguous, so the listing and the prune both use it —
and the index is built to match.

## Why the cap is enforced on insert

The calculator is a floating component people leave open, so an uncapped tape grows
without bound from ordinary use. 50 rows is comfortably more than anyone scrolls back
through.

The prune is a single `DELETE … WHERE id NOT IN (SELECT … LIMIT 50)` in the **same
transaction** as the insert, rather than a scheduled job. Two reasons: a crash between
insert and prune would otherwise leave the tape permanently over its cap, and two quick
calculations could interleave into a double-prune. Doing it in SQL also avoids reading
every row back into JavaScript just to decide which to drop.

## What is *not* in this table

The calculator's **settings and last result** stay in `sys_user_preferences` as key/value
rows (migration 0044): `calc_angle_mode` and `calc_last_result`. They are single scalars,
read whole, so they need no table — and the last result has to be readable as cheaply as
the clock's face is, since it is what the minimized puck draws.

The reverse also holds: history is a growing, ordered, capped, clearable list, which is a
table's job. Storing 50 calculations as a JSON array in one preference row would mean
rewriting the whole list on every `=`.

**`AC` does not touch this table.** Clearing the display and clearing the tape are
separate actions with separate controls — a calculator that forgot your working-out
because you pressed clear would be a bug, not a feature.

## Rollback

```sql
DROP TABLE sys_calculator_history;
```

Loses saved tapes and nothing else. The calculator itself keeps working — the window
falls back to an empty history list, and the angle mode and last result are in user
preferences, untouched.
