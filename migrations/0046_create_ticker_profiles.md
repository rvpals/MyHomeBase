# Migration 0046: create stk_ticker_profiles

**Date:** 2026-08-16
**Type:** new table

## What this does

Caches reference data per ticker — currently the sector and industry a symbol
belongs to — so the Stocks & ETFs dashboard can chart **Allocation by sector**
without asking the provider about every position on every render.

| Column | Type | Notes |
|---|---|---|
| `ticker` | `TEXT PRIMARY KEY` | the symbol, upper-cased by the use-case |
| `sector` | `TEXT NOT NULL DEFAULT ''` | **blank = negative cache** (see below) |
| `industry` | `TEXT NOT NULL DEFAULT ''` | same payload, so free to store; nothing reads it yet |
| `manual_sector` | `TEXT NOT NULL DEFAULT ''` | user override; wins over `sector` when non-blank |
| `source` | `TEXT NOT NULL DEFAULT ''` | which provider supplied it |
| `fetched_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | when the lookup happened |

No index beyond the primary key — every read is by exact ticker, and the whole
table is small enough (one row per held symbol) that the sector roll-up reads all
of it at once.

## Why cache it at all

Sector already existed in the codebase, but only as a **live, per-ticker,
never-persisted** read in `src/lib/ticker-detail` for the ticker viewer. That is
fine for one symbol in a dialog and impossible for a roll-up: charting a
40-position portfolio would mean 40 outbound requests per page render.

The data is also near-static — a company changes sector approximately never — so
it is exactly the kind of fact worth storing once. Same reasoning, and
deliberately the same shape, as `stk_ticker_logos` (0033).

## The blank sector is a real answer, not a failure

Yahoo's `assetProfile` reports a sector for an individual equity and **nothing
for a fund** — there is no single sector for VTI. That is most ETFs, so without
recording the outcome the app would re-ask forever for the symbols guaranteed
never to answer.

The use-case draws the line that matters here: a provider response saying "no
sector" is **stored** as a blank row, while a *failed request* (Yahoo's
quoteSummary 401s whenever the crumb handshake fails — see the comment in
`yahoo-finance-client.ts`) stores nothing at all. Caching a network outage as a
permanent absence is the specific bug this avoids. A blank row older than 90 days
is retried, so a symbol that later gains a sector eventually picks one up.

Positions with no usable sector are charted under **"ETFs & funds"** rather than
"Unclassified" — for a fund that is the truthful label, not a gap in the data.

## `manual_sector` ships with no UI

The column exists from the start deliberately. SQLite cannot add a column to a
table with an existing primary key without the full create-copy-drop-rename
rebuild, so an unused column now is far cheaper than a migration later. Nothing
writes it yet; `resolveSector` already prefers it over the provider's value, so
the editing screen is additive when it comes.

## Rollback

```sql
DROP TABLE stk_ticker_profiles;
```

Dropping it only discards the cache — profiles are re-fetched on the next
Refresh All.
