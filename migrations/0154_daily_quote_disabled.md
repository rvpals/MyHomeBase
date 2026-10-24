# Migration 0154: take a quote out of rotation without deleting it

**Date:** 2026-10-23
**Type:** new column

## What this does

Adds `sys_daily_quotes.is_enabled`, a flag deciding whether a quote is a
candidate for the home-screen widget.

| Column | Type | Notes |
|---|---|---|
| `is_enabled` | `INTEGER NOT NULL DEFAULT 1` | `1` in rotation, `0` kept but never shown |

No index, no table rebuild, no backfill. One `ALTER TABLE ... ADD COLUMN`.

## Why it exists

Deleting was the only way to stop a quote appearing. That is a destructive
answer to a reversible question — a quote that reads badly on reflection, or
that belongs to a season that has passed, is usually worth keeping and not worth
showing. The column separates *is in the library* from *is in rotation*, and the
admin screen gains a Disable/Enable action beside Edit and Delete.

## Why the column is positive and the screen is negative

Stored as `is_enabled`; labelled "Disabled" in the UI.

Every other flag in this database is positive and defaults to on — `is_visible`
on `sys_modules` and `sys_toolbars`, `is_active` on the attendance tables.
Storing the negative here would make this the one table where `0` means
"normal", which is the kind of inconsistency that gets read wrong once and then
written wrong forever.

It also makes the migration free of a backfill: `DEFAULT 1` is already the right
answer for every row that exists, so a household upgrading sees exactly the
rotation it had the day before.

The screen still says "Disabled" because that is the exception worth naming —
nobody enables a quote that is already enabled. The inversion happens once, in
`view.tsx`, and never in the table or the domain type.

## Where the filter lives

In the repository, on `getRandomQuote` only:

```sql
SELECT * FROM sys_daily_quotes WHERE is_enabled = 1 ORDER BY RANDOM() LIMIT 1
```

Both widget paths go through that one function — the home page's server render
and the refresh button's `drawRandomQuoteAction` — so neither needed changing to
respect the flag, and neither can drift out of agreement with the other.

`listQuotes` is deliberately **not** filtered. It backs the admin grid, whose
job is to show the whole table; a disabled quote renders dimmed with a "Disabled"
pill rather than vanishing. An admin looking for a quote they disabled last month
should find it where they left it.

## When every quote is disabled

`getRandomQuote` returns `undefined`, which is the same thing it already returns
for an empty table, so the widget shows nothing and the refresh button reports
"No quotes are available."

That is the chosen behaviour, not a gap. The alternative — falling back to a
disabled quote when no enabled one exists — would mean the flag silently stops
being honoured at exactly the moment it is being used most deliberately.

## Toggling bumps `updated_at`

Migration 0025 put an `AFTER UPDATE` trigger on this table, so disabling a quote
touches its timestamp exactly as editing its text does.

Left alone on purpose. The admin list sorts by `created_at`, the widget never
reads `updated_at`, and "when did this row last change" remains a true answer to
a question nothing currently asks. Suppressing it would mean rewriting the
trigger to enumerate columns, which is more moving parts than the problem.

## Why `setQuoteEnabled` is its own use-case

The grid's toggle could have called `updateQuote` with the row's other four
fields unchanged. It does not: `setQuoteEnabled(repo, id, isEnabled)` writes the
one column.

A read-modify-write would make the toggle capable of clobbering an edit made in
another tab between the page render and the click, and it would route a
one-column change through a validator that demands non-empty quote text. The
narrow use-case can't do either.

`createQuote` takes `isEnabled` as an optional input defaulting to `true`, so the
newsletter importer, the Add Quote screen and any CLI caller kept working
untouched.

## Rolling back

Dropping the column loses which quotes were disabled and nothing else. Every
quote keeps its text, author, category and source, and the widget goes back to
drawing from the whole table.

`ALTER TABLE ... DROP COLUMN` is sufficient — no index names this column and no
view or trigger references it.
