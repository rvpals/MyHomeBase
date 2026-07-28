# Migration: drop the Real Estate Investment module

**Timestamp:** 2026-07-26
**Database:** C:/webapp/MHB_DATA/myhomebase.db (via MYHOMEBASE_DB in .env)
**Table(s) affected:** rei_properties, rei_property_snapshots, rei_watched_properties (dropped); sys_modules, sys_module_settings, sys_user_module_access (rows deleted)

## Reason

The Real Estate Investment module (core real estate + property watch) is being removed
from the application entirely, along with all of its data.

## Changes

- `DROP TABLE IF EXISTS` for `rei_property_snapshots`, `rei_watched_properties`,
  `rei_properties` (their triggers/indexes drop with them).
- Delete the `sys_modules` row `slug='real-estate-investment'` and its dependent
  `sys_module_settings` and `sys_user_module_access` rows.

Uses `IF EXISTS` / `WHERE`-scoped deletes so it is a safe no-op on a fresh install (where
the create migrations 0013/0014 and the 0001 seed were also removed).

## Data handling

**Destructive and intentional** — all real-estate properties, watched properties, and
price snapshots are permanently deleted. `scripts/migrate.ts` writes a timestamped backup
before running.

## Rollback

Restore from the backup `scripts/migrate.ts` writes: `<db>.bak-<timestamp>`.
