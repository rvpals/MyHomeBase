# Migration: rename all tables to module prefixes

**Timestamp:** 2026-07-26
**Database:** data/myhomebase.db
**Table(s) affected:** all tables except the CSV Analysis tables (already `csv_`-prefixed) and SQLite internals (`sqlite_sequence`).

## Reason

Give every table a three-letter module namespace so its owning module is obvious
from the name alone:

| Prefix | Module | Tables |
|---|---|---|
| `sys_` | Platform (not a feature module) | modules, app_settings, module_settings, users, user_module_access, sessions, schema_migrations |
| `rei_` | Real Estate Investment | properties, property_snapshots, watched_properties |
| `stk_` | Stocks & ETFs | investment_accounts, account_performance_records, stock_positions, stock_transactions, stock_watch_lists, stock_watch_list_items, stock_volatility_cache, stock_correlation_cache, stock_sharpe_cache |
| `csv_` | CSV Analysis | *(unchanged — already prefixed)* |

## Changes

Full old → new map:

```
schema_migrations            -> sys_schema_migrations
modules                      -> sys_modules
app_settings                 -> sys_app_settings
module_settings              -> sys_module_settings
users                        -> sys_users
user_module_access           -> sys_user_module_access
sessions                     -> sys_sessions
properties                   -> rei_properties
property_snapshots           -> rei_property_snapshots
watched_properties           -> rei_watched_properties
investment_accounts          -> stk_investment_accounts
account_performance_records  -> stk_account_performance_records
stock_positions              -> stk_stock_positions
stock_transactions           -> stk_stock_transactions
stock_watch_lists            -> stk_stock_watch_lists
stock_watch_list_items       -> stk_stock_watch_list_items
stock_volatility_cache       -> stk_stock_volatility_cache
stock_correlation_cache      -> stk_stock_correlation_cache
stock_sharpe_cache           -> stk_stock_sharpe_cache
```

## How it is applied

This is a pure table rename, so it uses SQLite's native `ALTER TABLE ... RENAME TO`
(the copy-rename-drop pattern is only needed for column/constraint changes). Two
coordinated paths keep fresh installs and existing databases identical:

1. **Fresh installs** — migrations `0001`–`0023` were rewritten to create the
   prefixed names directly. No rename runs.
2. **Existing database** — `scripts/migrate.ts` runs `reconcileLegacyTableNames(db)`
   before it reads the migration tracker. For each pair it renames only when the old
   table still exists and the new one does not (idempotent). This also renames the
   `schema_migrations` tracker itself to `sys_schema_migrations`, which a numbered
   `.sql` migration could not do — the tracker is written to mid-run.

There is intentionally **no `0024_*.sql`**: a numbered rename migration would fail on
a fresh install, where the tables already have the new names.

## Data handling

No data is copied or transformed — `RENAME TO` preserves all rows, indexes, and
triggers. Trigger and index **object names are left unchanged** (e.g. the trigger
`modules_set_updated_at` now sits on `sys_modules`); SQLite auto-rewrites their
*references* to the renamed table. This avoids drop/recreate risk and keeps a fresh
install byte-for-byte identical to a reconciled one.

The CSV Analysis module is untouched: its static tables already carry `csv_`, and its
user-generated per-entry tables (e.g. `csv_govee`) keep the `csv_` prefix produced by
`buildTableName` in `src/lib/csv-analytics/sql-builder.ts`.

## Code updated alongside the schema

- `migrations/0001`–`0018`, `0020`, `0023` — prefixed table names in `CREATE`/`INSERT`/`ALTER`.
- All repository SQL string literals under `src/lib/**/repository.ts`.
- `scripts/migrate.ts` — reconciliation step + tracker renamed to `sys_schema_migrations`.
- `src/app/(protected)/admin/sql-explorer/view.tsx` — example-query placeholder.

## Rollback

Restore from the timestamped backup that `scripts/migrate.ts` writes before running:
`data/myhomebase.db.bak-<timestamp>`.
