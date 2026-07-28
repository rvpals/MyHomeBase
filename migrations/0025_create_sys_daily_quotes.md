# Migration: create sys_daily_quotes

**Timestamp:** 2026-07-26
**Database:** C:/webapp/MHB_DATA/myhomebase.db (via MYHOMEBASE_DB in .env)
**Table(s) affected:** sys_daily_quotes (new)

## Reason

Daily-inspiration-quote feature: a widget card on the home screen shows a random
quote, and an admin "Daily Quote" node lets admins add/edit/delete quotes.

## Changes

New table `sys_daily_quotes`:

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| quote | TEXT NOT NULL | The quote text |
| author | TEXT NOT NULL DEFAULT 'Unknown' | |
| category | TEXT NOT NULL | Validated against a fixed list in the zod schema (no DB-level enum/FK, per project rules) |
| created_at | TEXT NOT NULL DEFAULT (datetime('now')) | |
| updated_at | TEXT NOT NULL DEFAULT (datetime('now')) | Kept current by trigger `daily_quotes_set_updated_at` |

Prefix `sys_` per the table-naming convention (platform/admin-managed content, not a
feature module).

## Data handling

Seeds 6 starter quotes so the home widget isn't empty on first run.

## Rollback

Restore from the timestamped backup that `scripts/migrate.ts` writes before running:
`<db>.bak-<timestamp>`. (Or `DROP TABLE sys_daily_quotes;` — it holds only seed/admin data.)
