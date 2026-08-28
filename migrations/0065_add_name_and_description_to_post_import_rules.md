# Migration 0065: a name and a description for each post-import rule

**Date:** 2026-08-27
**Type:** additive columns + back-fill
**Table(s) affected:** `exp_post_import_rules`

## What this does

| Column | Type | Notes |
|---|---|---|
| `name` | `TEXT NOT NULL DEFAULT ''` | Short human label, e.g. `TGI Friday's`. **Required** for new and edited rules — enforced in `savePostImportRuleSchema`, not by a `CHECK`. |
| `description` | `TEXT NOT NULL DEFAULT ''` | Optional longer note on why the rule exists. Empty means none. |

And it back-fills `name` from `pattern` for rules that already exist.

## Why

A rule was identified by its glob pattern everywhere it appeared — the rule list,
the delete confirmation, the clean-up run log (`rule "*TGI*" used, …`), and the
`explain-rule` CLI. A pattern states what a rule *matches*; it never states why the
rule exists. `*TGI*` doesn't record that the card prints TGI Friday's under three
different names, which is the fact worth keeping.

## Why the columns are `TEXT NOT NULL DEFAULT ''`

Matches every other optional text column in this module (`exp_transactions.vendor`,
`note`, `exp_post_import_rule_actions.field_value`), so no read has to handle both a
`NULL` and a blank. SQLite adds a `NOT NULL` column with a non-null default in place,
so this needs no table rebuild.

## Why `name` is required in code, not in the schema

The requirement lives in `savePostImportRuleSchema` (zod), which is the same place
the `field_name` allowlist and the status validation already live. Keeping the
invariant in one place is this module's existing convention, and a `CHECK
(TRIM(name) <> '')` would additionally have made the back-fill order load-bearing.

## The back-fill, and why it isn't optional

```sql
UPDATE exp_post_import_rules
SET name = TRIM(pattern)
WHERE TRIM(name) = '' AND TRIM(pattern) <> '';
```

Without this, every pre-existing rule would hold `name = ''` — and since the form now
requires a name, opening an old rule to change its priority would refuse to save until
you invented one. Naming a rule after its pattern is also exactly what the UI displayed
before this migration, so **no existing rule changes how it reads.**

Two details:

- **`TRIM(pattern)`** because `compilePattern` trims before matching, so a pattern
  stored with surrounding whitespace already behaves as its trimmed form.
- **`WHERE TRIM(name) = ''`** makes the statement idempotent — re-running it can't
  overwrite a name someone has since set. The `AND TRIM(pattern) <> ''` guard covers
  the one case the copy would otherwise not fix: a whitespace-only pattern can't
  stand in as a name. Such a rule keeps `name = ''` and must be named by hand, which
  is correct — a blank pattern never matches anything (`matchesPattern`), so the rule
  is inert either way.

## No unique index on `name`

Names are for humans. `priority` then `id` already establishes both evaluation order
and identity, so nothing needs a name to be unique, and a unique constraint would
reject a reasonable duplicate at save time for no benefit.

## Where the name now appears

Beyond the rule list and the editor, the name flows into the two places that
previously quoted a pattern:

- `CleanupLogEntry` gained `ruleName`, so a run-log line reads
  `rule "TGI Friday's" used, …`. `pattern` is kept alongside it.
- `explain-rule` prints the name with each candidate rule and for the winner.

Both fall back to the pattern when a name is blank, which only pre-back-fill rows or
a whitespace-only-pattern rule can be.

## Data handling

Additive columns with defaults, so no row can fail to migrate. The back-fill only
writes rows whose `name` is blank, i.e. every row at the moment this runs and none
afterwards. The runner wraps the migration in a transaction, so a partial back-fill
rolls back.

## Rollback

```sql
ALTER TABLE exp_post_import_rules DROP COLUMN description;
ALTER TABLE exp_post_import_rules DROP COLUMN name;
```

Safe — nothing references either column, and no index or trigger covers them. Any
name text entered since the migration is lost, which is inherent to dropping it.
