# Migration 0099: create stk_index_logos

**Date:** 2026-09-18
**Type:** new table

## What this does

Caches a small icon per market index, so the Indexes card on the Stocks & ETFs
dashboard can show a mark beside "S&P 500", "NASDAQ Composite", "Gold" and the
rest rather than a column of bare text.

| Column | Type | Notes |
|---|---|---|
| `symbol` | `TEXT PRIMARY KEY` | the provider symbol, e.g. `^GSPC`, `GC=F`, `DX-Y.NYB` |
| `image` | `BLOB` (nullable) | **NULL = negative cache** (see below) |
| `image_mime_type` | `TEXT` (nullable) | NULL alongside a NULL image |
| `source` | `TEXT NOT NULL DEFAULT ''` | the URL it came from, so it's clear where a stored icon originated when the upstream service changes |
| `fetched_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | when the lookup happened |

No index beyond the primary key — every read is by exact symbol.

## Why not reuse stk_ticker_logos

They are keyed by different things and filled from different services:

- A **ticker** is a company, and Financial Modeling Prep's `image-stock`
  endpoint serves artwork for one. Symbols must match `^[A-Z0-9.\-]{1,15}$`.
- An **index** is not a company. `^GSPC`, `GC=F` and `DX-Y.NYB` fail that
  pattern outright, and no stock-logo endpoint has anything for them. What each
  one *does* have is an organisation behind it with a website, so the icon is
  fetched by domain from the same favicon service the vendor icons already use.

Sharing one table would have meant relaxing the ticker validator — the one
thing stopping a user-supplied symbol reaching a third-party URL — to
accommodate rows that were never tickers.

## The domain is the lookup key, not the symbol

`logoDomain` lives on the catalogue entry in
[src/lib/market-indexes/catalogue.ts](../src/lib/market-indexes/catalogue.ts),
and it is the only thing that reaches the outbound request. The route resolves
a symbol to a catalogue entry and 404s if there isn't one, so an index symbol
never leaves the process. Each domain was checked against the service rather
than guessed; two are not the obvious choice and are commented in the
catalogue (Russell 2000 uses LSEG's mark, as FTSE Russell's own domain has no
icon there).

## Constraints enforced in code, not the database

The use-case accepts `image/png`, `image/jpeg`, `image/webp`, `image/gif` and
the two ICO mime types — favicons are commonly ICO, which is why the list is
wider than the ticker-logo one. SVG is excluded deliberately: it is a script
carrier and the bytes come from a third party. A download is capped at 128 KB.

## Rollback

```sql
DROP TABLE stk_index_logos;
```

Dropping it only discards the cache; icons are re-downloaded on demand.
