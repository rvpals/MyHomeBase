# Migration 0069: the rule wildcard becomes `%`

**Date:** 2026-08-29
**Type:** data rewrite (no schema change)
**Table(s) affected:** `exp_post_import_rules`

## What this does

Rewrites every `*` in a stored rule pattern to `%`:

```sql
UPDATE exp_post_import_rules
SET pattern = REPLACE(pattern, '*', '%')
WHERE pattern LIKE '%*%' ESCAPE '\';
```

No columns are added, dropped or retyped.

## Why

`*` was the wildcard *and* one of the most common characters in the text it was
matched against. Card descriptions print asterisks constantly:

| Description | What the `*` is |
|---|---|
| `AMAZON.COM*2A34B5C6` | per-order reference |
| `SQ *JOES COFFEE` | payment-processor prefix |
| `COSTCO *ANNUAL RENEWAL*` | the card's own annotation |
| `UBER   *TRIP HELP.UBER.COM` | processor prefix |

So the pattern language had no way to spell "an actual asterisk here." Every
attempt to name one silently produced a wildcard, and the rule came out **broader
than the user wrote it**:

- `AMAZON.COM*` meant "starts with AMAZON.COM" — it also caught
  `AMAZON.COM RETURN CREDIT`.
- `COSTCO *ANNUAL RENEWAL*` matched, but only because its wildcards happened to
  swallow the literal asterisks — not because the pattern meant what it read as.
  A card rendering the same charge as `COSTCO*ANNUAL RENEWAL` (no space) would
  have stopped matching, because the literal space after `COSTCO` was
  load-bearing.

Every failure was in the *permissive* direction, which is why nothing looked
broken — a rule that quietly matches too much is discovered months later, by
which point transactions have been miscategorised.

## Why `%`

Candidates were ranked on how often they appear in real statement text:

| Char | Verdict |
|---|---|
| `%` | **chosen** — effectively absent from card descriptions, and already reads as a wildcard from SQL `LIKE` |
| `~` | also clean, slightly less familiar |
| `@` | rejected — `SHELL @ MAIN ST`, merchant handles |
| `#` | rejected — store numbers are everywhere (`COSTCO WHSE #1017`, `WALMART #2841`); this would have recreated the exact problem, with `WALMART #` silently becoming "any Walmart-prefixed text" |

## Why the rewrite is exact

Every `*` that reached the database was a wildcard, because that is the only
meaning the old `compilePattern` gave it. Replacing each one with the new
wildcard therefore preserves behaviour precisely: **no existing rule changes
which descriptions it matches.** A rule reading `*TGI*` becomes `%TGI%` and goes
on matching the same rows.

That is also why the rewrite is unconditional rather than opt-in. Leaving old
patterns alone would strand them: `*` is a literal from now on, so an untouched
`*TGI*` would start hunting for asterisks around "TGI" and match nothing.

Two details on the statement:

- **`LIKE '%*%'`** — in `LIKE`, `%` is the pattern language, so finding a literal
  asterisk means wrapping it in `%` on both sides. `ESCAPE '\'` is declared for
  the benefit of future edits; no character in this particular pattern needs it.
- **Re-running is harmless.** After the first pass no pattern contains `*`, so
  the `WHERE` matches nothing. It isn't idempotent in the strict sense — a
  one-way character translation can't be — but a second run cannot corrupt a row.

## Scope

`exp_post_import_rules.pattern` is the only place a glob is stored — confirmed
against `repository.ts`, where `pattern` appears solely in that table's insert,
update and row mapper. No setting, no other module, no index and no trigger
references it.

## Code shipping with this

- `compilePattern` ([src/lib/expense/rules.ts](../src/lib/expense/rules.ts)) now
  splits the pattern on `%`, escapes each segment, and joins with `[\s\S]*`. The
  previous implementation escaped everything and then turned `\*` back into a
  wildcard; splitting removes that escape-then-unescape pass, so there is no step
  a metacharacter can slip through.
- `%` keeps the second job `*` had: **its presence anchors the pattern.** With no
  `%` a pattern still matches anywhere, so a bare `TGI` behaves as `%TGI%`. That
  was deliberately left as-is — changing anchoring too would have altered saved
  rule behaviour beyond this mechanical translation.
- Help text in the rules view, the `expense-create-rule` usage, and the
  `PostImportRule.pattern` doc comment all updated.

## Rollback

```sql
UPDATE exp_post_import_rules
SET pattern = REPLACE(pattern, '%', '*')
WHERE pattern LIKE '%\%%' ESCAPE '\';
```

Restores the pre-migration text for any rule untouched since. **Caveat:** a `%`
typed *after* this migration is a wildcard the old code can't express, and the
rollback turns it into a literal `*` — so a rule written post-migration comes back
meaning something different. Reverting the code without reverting the data is the
safer half-measure if that matters, since old `compilePattern` treats `%` as an
ordinary literal.

## Data handling

A single `UPDATE` inside the runner's transaction, so a partial rewrite rolls
back. No row can fail to migrate: `REPLACE` on a value with no `*` is a no-op,
and the `WHERE` excludes those rows anyway.
