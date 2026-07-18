# Migration 0017: create stock_watch_lists and stock_watch_list_items

**Date:** 2026-07-17
**Type:** new tables

## What this does

Named watch lists of tickers for the Stocks & ETFs module, ported from the
InvestHelp PWA's `watch_lists`/`watch_list_items`. Renamed with a `stock_`
prefix to disambiguate from the Real Estate module's own watch list
(`watched_properties`/`property_snapshots`, migration 0014) — unrelated
concepts that happened to share a name in the source app.

## `stock_watch_lists`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | internal PK |
| `name` | `TEXT NOT NULL` | |
| `created_at` / `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `updated_at` trigger-maintained |

## `stock_watch_list_items`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | internal PK |
| `watch_list_id` | `INTEGER NOT NULL` | no FK constraint (project convention) — the repository deletes a list's items in the same transaction as the list itself |
| `ticker` | `TEXT NOT NULL` | |
| `shares` | `REAL NOT NULL DEFAULT 0` | fractional shares allowed |
| `price_when_added_cents` | `INTEGER NOT NULL DEFAULT 0` | snapshot of the live price at the moment the ticker was added |
| `added_date` | `TEXT NOT NULL` | ISO date string |
| `reminder_at` | `TEXT` (nullable) | ISO datetime |
| `reminder_message` | `TEXT NOT NULL DEFAULT ''` | |
| `created_at` / `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `updated_at` trigger-maintained |

`idx_stock_watch_list_items_watch_list_id` — the only query pattern is "all
items for one watch list."

## No seed data

Both tables start empty.

## Rollback

```sql
DROP TABLE stock_watch_list_items;
DROP TABLE stock_watch_lists;
```
