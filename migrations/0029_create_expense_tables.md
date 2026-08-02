# Migration 0029: create Expense module tables

**Date:** 2026-08-01
**Type:** new tables

## What this does

Creates the four tables behind the **Expense** tracker: credit-card accounts, an
editable category list, card transactions, and the fuzzy vendor→category rules.

Conventions followed: `exp_` module prefix, plural table names, `snake_case`
columns, money as INTEGER cents, `created_at`/`updated_at` with an `updated_at`
trigger, and **no database-level foreign keys** (the repository maintains the
links).

## `exp_transactions`

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `transaction_date` | `TEXT NOT NULL` | `YYYY-MM-DD` |
| `posting_date` | `TEXT NOT NULL DEFAULT ''` | blank when the statement omits it |
| `transaction_account_id` | `INTEGER NOT NULL` | → `exp_creditcard_accounts.id` |
| `transaction_description` | `TEXT NOT NULL DEFAULT ''` | raw vendor text from the statement; kept verbatim because it's the fuzzy-match input |
| `category_name` | `TEXT NOT NULL DEFAULT ''` | → `exp_categories.name`; `''` = not categorised yet (how imports arrive) |
| `amount_cents` | `INTEGER NOT NULL DEFAULT 0` | charges positive, credits/refunds negative |
| `note` | `TEXT NOT NULL DEFAULT ''` | added by the user after import |
| `status` | `TEXT NOT NULL DEFAULT 'new'` | `new` \| `reconciled` \| `irreconcilable` (validated in the zod schema, not by a CHECK constraint) |
| `created_by_user_id` | `INTEGER NOT NULL` | → `sys_users.id`; stored as an id so a rename doesn't orphan it |
| `created_at` / `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `updated_at` trigger-maintained |

Indexes, each for a real query: `transaction_date` (default sort and every
date-range total), `transaction_account_id` (per-card views), `category_name`
(filter/group by category), `status` (finding rows still to reconcile).

## `exp_creditcard_accounts`

`id`, `name` (required), `description`, `credit_line_cents`, timestamps.

## `exp_categories`

`name` (TEXT primary key), `description`, timestamps. Editable, and a name used
on a transaction is registered automatically — the same pattern as
`jrn_categories`.

## `exp_category_rules`

`pattern` (case-insensitive glob such as `AMAZON*`), `category_name`,
`apply_status` (optional status to set, `''` = leave alone), `priority` (lowest
wins when several rules match), `is_enabled`, timestamps. Rules are **global** —
they apply to every card. Indexed by `(priority, id)`, the order they're
evaluated in.

## No seed data

All four tables start empty. The module row itself is seeded in migration 0030.

## Rollback

```sql
DROP TABLE exp_category_rules;
DROP TABLE exp_transactions;
DROP TABLE exp_categories;
DROP TABLE exp_creditcard_accounts;
```
