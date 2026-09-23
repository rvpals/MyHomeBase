# Migration 0107: grouping transaction rules by Type

**Date:** 2026-09-23
**Type:** one new table, one added column

## What this does

Adds a user-curated **Transaction Rule Type** list, and a column on each rule
saying which type it belongs to.

| Object | Shape | Notes |
|---|---|---|
| `exp_rule_types` | `name` PK, `description`, `sort_order`, `created_at`, `updated_at` | The curated list, managed under Expense → Meta Data |
| `exp_post_import_rules.type_name` | `TEXT NOT NULL DEFAULT ''` | Which type the rule is filed under; `''` = Untyped |

## The problem it solves

The Transaction Rules screen rendered every rule as one flat list, directly on
the page. That was fine at five rules. Past about twenty it stops being a list
and becomes a haystack: restaurant patterns, subscription patterns, and
one-off "the card prints this vendor three ways" corrections all sit at the
same level with nothing separating them, so finding the rule you came to edit
means reading every row.

The reader already groups these in their head. This stores that grouping so the
screen can filter on it.

## Name as the primary key, not a surrogate id

`exp_rule_types.name` is the key, and a rule stores `type_name` as text.

This follows `exp_categories` (migration 0029) rather than inventing a
different shape, and it is the same decision a rule *action* already makes when
it stores a category by name. Three consequences, all wanted:

- **The rule row is readable on its own.** `type_name = 'Subscriptions'` says
  what it means in a SQL Explorer query with no join.
- **A rule may name a type that is not in the curated list yet.** That is the
  established convention in this module for categories and vendors — free text
  is allowed, and the saved list is a shortcut rather than a constraint. Saving
  a rule registers its type if it is missing, exactly as
  `registerRuleCategories` already does for categories.
- **Renaming a type is a rename, not a re-point.** Noted as a limit rather than
  a feature: there is no rename UI, and typing a new name creates a new type.

## No foreign key

Deliberate, and the same call migration 0029 made for categories.

A foreign key here would force one of two behaviours on delete, and both are
wrong for this data. `ON DELETE CASCADE` would delete the user's *rules*
because they tidied up a label — catastrophic and irreversible. `RESTRICT`
would refuse to delete a type until every rule using it had been edited first,
which turns a one-second cleanup into a chore.

Instead, deleting a type leaves its rules alone and they read as **Untyped**.
That mirrors what deleting a category already does to a transaction: the
history survives, only the label goes. The rules keep working — `type_name` is
display-and-filter only, and nothing in matching, priority, or the clean-up run
reads it.

## No backfill

Every existing rule gets `''` and renders under **Untyped**.

There is no honest way to derive a type for a rule written before types
existed. A guess based on the pattern or the fields it sets would produce a
confident-looking heading the author never chose, and hiding a rule under the
wrong heading is worse than leaving it visibly unfiled — Untyped is a group the
filter shows, not a hidden state.

## `sort_order` with nothing setting it

The column is in the DDL, and no UI writes to it yet.

The filter strip on the rules screen will eventually want a deliberate order —
the types you use most, first — rather than an alphabetical one. Adding the
column now costs a default-0 integer; adding it later costs another migration
against a table the user has already filled in. Until something sets it, every
row holds `0` and `name` is the tiebreak, so the list reads alphabetically.

## Rollback

```sql
DROP TRIGGER exp_rule_types_set_updated_at;
DROP TABLE exp_rule_types;
ALTER TABLE exp_post_import_rules DROP COLUMN type_name;
```

Safe. Nothing in rule matching, priority ordering, the import path or the
clean-up run reads `type_name` — it drives the Meta Data card and the rules
list's filter strip, and nothing else. Dropping it loses the user's grouping
and returns the screen to one flat list; every rule keeps matching and setting
exactly what it did before.
