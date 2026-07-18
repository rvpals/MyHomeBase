# Migration 0013: create properties table

**Date:** 2026-07-16
**Type:** new table

## What this does

Creates `properties`, the data store for the Real Estate module
(`real-estate-investment`). One row per property in a shared, household-wide
portfolio — not scoped to a single user.

## Columns

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | internal PK |
| `address` | `TEXT NOT NULL` | single free-text field |
| `purchase_price_cents` | `INTEGER NOT NULL` | money stored as integer cents to avoid float rounding — the convention for money going forward in this app |
| `purchase_date` | `TEXT NOT NULL` | ISO date string |
| `current_value_cents` | `INTEGER NOT NULL` | integer cents |
| `mortgage_balance_cents` | `INTEGER NOT NULL DEFAULT 0` | integer cents |
| `notes` | `TEXT` (nullable) | |
| `created_at` / `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `updated_at` trigger-maintained |

No FK constraints (project convention — relationships are managed in app
code). No `user_id` — the portfolio is shared across every user with access
to the module. No additional indexes; the table is expected to stay small
and is listed ordered by `created_at`.

## No seed data

Starts empty. Populated through the module's UI/CLI.

## Rollback

`DROP TABLE properties;`
