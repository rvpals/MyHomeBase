# Migration 0038: brokerage firm, broker reference, and honest duplicate detection

**Date:** 2026-08-05
**Type:** additive columns + unique-index replacement
**Table(s) affected:** `stk_stock_transactions`

## What this does

| Column | Type | Notes |
|---|---|---|
| `brokerage_firm` | `TEXT NOT NULL DEFAULT ''` | Where the trade was executed, e.g. `Chase`. Empty means not recorded. |
| `external_id` | `TEXT NOT NULL DEFAULT ''` | The broker's own reference/confirmation number, when the export gives one. Empty means none. |

And it replaces the table's unique index, which was wrong in a way that lost data.

## Why `brokerage_firm` is free text, not a foreign key

`stk_investment_accounts` exists, and positions were re-keyed to
`(account_id, ticker)` in migration 0035, so a foreign key was the obvious
alternative. Text wins here because a transaction is a **historical event**:

- The firm a trade happened at is a fact about that event. It should survive the
  account being renamed, closed, or deleted — a foreign key would either break or
  silently rewrite history.
- Broker CSV exports carry a firm as a name, not an id, and may name a firm you no
  longer hold an account with.

Empty string rather than `NULL`, matching `note` and the table's other text columns,
so no read has to handle both a null and a blank.

## The index was broken, and adding a column wouldn't have fixed it

`idx_stock_transactions_unique` was on
`(transaction_at, action, ticker, total_amount_cents)` and existed to make
re-importing a CSV a safe no-op.

**`transaction_at` is a DATE, not a timestamp.** So two buys of the same ticker for
the same amount on the same day are identical on all four columns, and the second was
rejected as a duplicate of the first. Buying a position in several lots through a day
is completely ordinary, and this silently dropped every lot after the first.

Appending `brokerage_firm` — the original plan for this migration — would not have
helped: both lots were at the same firm. **No column added to that index fixes it**,
because the rows really are identical at date granularity. The index had to go.

## What replaces it

Two ideas, because there are two cases:

1. **`idx_stock_transactions_external_id`** — `UNIQUE (external_id) WHERE
   external_id <> ''`. When the broker gives a reference number, that identifies the
   trade exactly, and the database enforces it. The partial `WHERE` is what makes
   this workable: rows with no id aren't covered at all, so they can't collide on a
   shared empty string.

2. **Count-based detection in the importer**, for rows with no id. Instead of asking
   "does a row like this exist?", the importer asks **"how many rows like this does
   the file have, and how many does the table already have?"** and inserts the
   shortfall. Three identical buys in the file against none stored inserts three;
   re-importing the same file inserts none. See `importTransactionsFromCsv`.

   `idx_stock_transactions_natural_key` on `(transaction_at, ticker, action)` makes
   that count cheap.

## What this gives up

The database no longer refuses a duplicate transaction outright when there's no
external id — the guarantee moves into the importer. That is the correct trade:
**two identical trades in one day are legal**, so the database cannot tell a real
second lot from an accidental re-import. Only the importer, which can see the whole
file at once, has enough information to decide.

A consequence: adding the same transaction twice **by hand** now succeeds. That's
intended, and it's the same reason — the app can't know whether you meant it.

## Data handling

Production holds **0 transaction rows**, so nothing is back-filled and no existing
pair can collide. Rows created before this migration read `''` for both columns —
honest, since neither was captured.

The index change is strictly more permissive, so it cannot reject anything the old
one accepted.

## Rollback

Restoring the old index can **fail** if any two rows differ only by firm, or are two
same-day lots — both legal under this migration and neither legal under the old
index. Check before running it:

```sql
DROP INDEX idx_stock_transactions_natural_key;
DROP INDEX idx_stock_transactions_external_id;
CREATE UNIQUE INDEX idx_stock_transactions_unique
  ON stk_stock_transactions (transaction_at, action, ticker, total_amount_cents);
ALTER TABLE stk_stock_transactions DROP COLUMN external_id;
ALTER TABLE stk_stock_transactions DROP COLUMN brokerage_firm;
```
