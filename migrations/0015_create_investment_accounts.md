# Migration 0015: create investment_accounts and account_performance_records

**Date:** 2026-07-17
**Type:** new tables

## What this does

First tables for the Stocks & ETFs module (`stock-etfs`), ported from the
InvestHelp PWA. `investment_accounts` is one row per brokerage/investment
account; `account_performance_records` is a point-in-time value snapshot for
one account, editable/deletable (unlike the append-only snapshots pattern
used by `property_snapshots`), matching the source app's CRUD behavior.

## `investment_accounts`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | internal PK |
| `name` | `TEXT NOT NULL` | |
| `description` | `TEXT NOT NULL DEFAULT ''` | |
| `initial_value_cents` | `INTEGER NOT NULL DEFAULT 0` | money as integer cents |
| `last_value_cents` | `INTEGER` (nullable) | denormalized cache of the most recent performance record's value, kept in sync by the use-case that adds a performance record (see `account_performance_records` below) |
| `last_updated_at` | `TEXT` (nullable) | ISO datetime; updated alongside `last_value_cents` |
| `created_at` / `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `updated_at` trigger-maintained |

## `account_performance_records`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | internal PK |
| `account_id` | `INTEGER NOT NULL` | no FK constraint (project convention) |
| `total_value_cents` | `INTEGER NOT NULL DEFAULT 0` | |
| `record_date` | `TEXT NOT NULL` | ISO date string |
| `note` | `TEXT NOT NULL DEFAULT ''` | |
| `created_at` / `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `updated_at` trigger-maintained |

Unique index `idx_account_performance_records_account_id_record_date` on
`(account_id, record_date)` — one record per account per day (upsert target),
and doubles as the index for "all records for this account" since `account_id`
is the leading column.

## Denormalization flag

`investment_accounts.last_value_cents`/`last_updated_at` duplicate data
derivable from `account_performance_records` (the latest row per account).
Carried over from the source app because the UI reads it on every account
list render and recomputing "latest performance record per account" on every
list load is wasteful for no benefit here. The use-case that inserts a
performance record is responsible for keeping this in sync in the same
transaction — flagged per project convention rather than done silently.

## No seed data

Both tables start empty.

## Rollback

```sql
DROP TABLE account_performance_records;
DROP TABLE investment_accounts;
```
