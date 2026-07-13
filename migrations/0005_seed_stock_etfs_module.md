# Migration 0005: seed Stock & ETFs module

**Date:** 2026-07-13
**Type:** data-only (no schema change — `modules` already has every column needed)

## What this does

Adds a second module: Stock & ETFs, sequence 2, visible.

| Field | Value |
|---|---|
| `slug` | `stock-etfs` |
| `short_name` | `Stocks & ETFs` |
| `long_name` | `Stock & ETFs etc` |
| `description` | `Manage stock and ETF investments.` |
| `icon` | `chart` |

Also added to `DEFAULT_MODULES` in `src/lib/modules/defaults.ts`, so "Reset to
Default" restores this module instead of deleting it — keep both in sync if
either changes.

## Rollback

`DELETE FROM modules WHERE slug = 'stock-etfs';`
