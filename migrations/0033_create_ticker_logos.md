# Migration 0033: create stk_ticker_logos

**Date:** 2026-08-03
**Type:** new table

## What this does

Caches a small logo per ticker for the Stocks & ETFs module, so positions,
watch lists and analytics can show artwork beside each symbol.

| Column | Type | Notes |
|---|---|---|
| `ticker` | `TEXT PRIMARY KEY` | the symbol, upper-cased by the use-case |
| `image` | `BLOB` (nullable) | **NULL = negative cache** (see below) |
| `image_mime_type` | `TEXT` (nullable) | NULL alongside a NULL image |
| `source` | `TEXT NOT NULL DEFAULT ''` | the URL it came from, so it's clear where a stored logo originated when the upstream service changes |
| `fetched_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | when the lookup happened |

No index beyond the primary key — every read is by exact ticker.

## Why a BLOB, and why the negative cache matters

Consistent with `sys_users.avatar` (0011) and
`exp_creditcard_accounts.card_image` (0031): bytes live in the database and are
served by a dedicated route, so they never ride along in a page's JSON and the
browser can cache them. Downloading once also means the module keeps rendering
logos when the upstream service is slow or unreachable.

**A row with `image IS NULL` records "we looked and found nothing."** Plenty of
tickers — most ETFs, anything obscure — have no logo. Without storing that
outcome, every page render would fire another failed request for them. `fetched_at`
means a negative result can be retried after a while (the use-case treats one
older than 30 days as worth another try) rather than being permanent.

## Constraints enforced in code, not the database

The use-case only accepts `image/png`, `image/jpeg` and `image/webp`, caps a
download at 256 KB, and validates the ticker against `^[A-Z0-9.\-]{1,15}$`
before putting it in an outbound URL — the symbol is user-supplied data being
interpolated into a third-party request, so it is not trusted.

## Rollback

```sql
DROP TABLE stk_ticker_logos;
```

Dropping it only discards the cache; logos are re-downloaded on demand.
