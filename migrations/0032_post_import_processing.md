# Migration 0032: post-import processing

**Date:** 2026-08-02
**Type:** additive columns + table replacement (with data migration)

## What this does

Turns the Expense auto-categorise rules into a general **post-import processing**
step: a rule matches a description and then sets *any number of fields*, not just
a category. Transactions gain a cleaned-up `vendor` and a `processed` flag that
acts as the clean-up work queue.

## `exp_transactions` — two new columns

| Column | Type | Notes |
|---|---|---|
| `vendor` | `TEXT NOT NULL DEFAULT ''` | tidy name (e.g. "TGI Friday") derived from the raw statement text, which stays untouched in `transaction_description` |
| `processed` | `INTEGER NOT NULL DEFAULT 0` | 0 = still to be run through the rules |

Indexed on `processed`, because "everything not yet processed" is the query the
clean-up runs on every batch.

**Existing rows get `processed = 0`**, so the first clean-up pass applies the
rules to the whole back catalogue. That's deliberate — it's how already-imported
history picks up vendors and categories.

## Rules: one table becomes two

A rule was *pattern → category (+ optional status)*. It's now *pattern → many
assignments*, which the old columns can't express.

### `exp_post_import_rules`
`id`, `pattern` (case-insensitive glob), `priority` (lowest wins), `is_enabled`,
timestamps. Indexed by `(priority, id)` — the evaluation order.

### `exp_post_import_rule_actions`
`id`, `rule_id`, `field_name`, `field_value`, `sort_order`, `created_at`.
Indexed by `rule_id`.

`field_name` is restricted to `categoryName`, `vendor`, `status` and `note` by
the zod schema rather than a `CHECK` constraint, so the allowlist lives in one
place in code and a bad status value is rejected with a readable message.

## Existing rules are migrated, not discarded

Rows are copied across **with their ids preserved**; each non-blank
`category_name` becomes a `categoryName` action and each non-blank `apply_status`
a `status` action. `exp_category_rules` is then dropped (which takes its index
and trigger with it).

This is the copy-then-drop shape the project's guide asks for when a table's
columns change, rather than an in-place `ALTER`.

## Rollback

The old table can be rebuilt from the new ones, keeping one category and one
status per rule:

```sql
CREATE TABLE exp_category_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern       TEXT    NOT NULL,
  category_name TEXT    NOT NULL,
  apply_status  TEXT    NOT NULL DEFAULT '',
  priority      INTEGER NOT NULL DEFAULT 0,
  is_enabled    INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO exp_category_rules (id, pattern, category_name, apply_status, priority, is_enabled, created_at, updated_at)
SELECT r.id,
       COALESCE((SELECT field_value FROM exp_post_import_rule_actions
                 WHERE rule_id = r.id AND field_name = 'categoryName' LIMIT 1), ''),
       COALESCE((SELECT field_value FROM exp_post_import_rule_actions
                 WHERE rule_id = r.id AND field_name = 'status' LIMIT 1), ''),
       r.priority, r.is_enabled, r.created_at, r.updated_at
FROM exp_post_import_rules r;

DROP TABLE exp_post_import_rule_actions;
DROP TABLE exp_post_import_rules;
DROP INDEX IF EXISTS idx_exp_transactions_processed;
ALTER TABLE exp_transactions DROP COLUMN processed;
ALTER TABLE exp_transactions DROP COLUMN vendor;
```

Any vendor/note assignments a rule gained after this migration are lost on
rollback — the old schema has nowhere to put them.
