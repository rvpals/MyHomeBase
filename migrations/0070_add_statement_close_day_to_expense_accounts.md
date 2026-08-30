# Migration 0070: add a statement close day to expense accounts

**Date:** 2026-08-29
**Type:** additive column

## What this does

Gives each credit-card account the day of the month its statement closes, so the
Transactions screen can group spend by billing cycle the way the card bills it.

| Column | Type | Notes |
|---|---|---|
| `statement_close_day` | `INTEGER NOT NULL DEFAULT 0` | day of the month, 1–31; `0` means never set |

Plain `ALTER TABLE ADD COLUMN` — an additive column with a default, so no
rebuild, and existing rows are valid as they stand.

## Why the column is on the account, not the transaction

A billing period is a property of the *card*. A card closing on the 28th bills
29 Jul – 28 Aug; a card closing on the 5th bills a different stretch of the same
calendar month. Storing a period per transaction would denormalise a fact that
belongs to the card and would go stale the moment the close day were corrected —
so the cycle is *derived* at read time from the date and the card's close day,
and nothing about a cycle is persisted.

That also means correcting a close day silently re-groups the history, which is
the behaviour you want: the old grouping was simply wrong.

## Why the default is 0 and there is no back-fill

`28` is the right default for a card being **added** — most cards close near the
end of the month, so the Meta Data form offers 28 — but it would be a lie stored
against an existing row, indistinguishable from a day the user had actually
confirmed.

`0` is therefore a real state meaning "never set":

- `creditCardAccountSchema` admits `0`, so an existing card stays *readable*.
  Refusing it here would have made every pre-migration card un-loadable.
- `saveAccountSchema` requires 1–31, so `0` can never be *written*. Once a card
  is saved through the form it carries a real day.
- `normalizeCloseDay()` in `src/lib/expense/billing-cycle.ts` resolves `0` (and
  anything else out of range) to `DEFAULT_STATEMENT_CLOSE_DAY` at read time, so
  the cycle view groups an untouched card plausibly instead of collapsing it into
  one undifferentiated pile — and one bad row can't blank the whole screen.

Meta Data flags a card still sitting on `0`, so the guess is visible rather than
silent.

## What the database does not enforce

- **No CHECK on the 1–31 range.** `saveAccountSchema` is the only writer and
  already applies it, which is where this module's invariants live per
  `ARCHITECTURE.md`. Adding a CHECK to an existing SQLite table requires the full
  create-copy-drop rebuild — a poor trade for a bound already held.
- **No index.** Every read of this column arrives with the account row already in
  hand, and an account list is a handful of rows.
- **No clamping.** A close day of 31 is stored as 31, not rewritten per month.
  February's close is computed as the 28th (29th in a leap year) when the cycle is
  derived, so the user's stated intent — "the end of the month" — survives, which
  a stored clamp would destroy.

## Rollback

```sql
ALTER TABLE exp_creditcard_accounts DROP COLUMN statement_close_day;
```
