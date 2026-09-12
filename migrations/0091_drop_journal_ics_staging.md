# 0091 — Drop the calendar-import staging table (undoes the deleted 0090)

## Why there is no 0090 in this folder

There was. `0090_create_journal_ics_staging.sql` created
`jrn_ics_staged_events`, and it was applied to the deployed NAS database at
deployment #51 before being reverted. The file is deleted; this migration drops
what it made.

Anyone reading the sequence and finding 0090 missing but present in
`sys_schema_migrations` is looking at the right thing — that row is deliberately
left in place. See *Why the history row stays* below.

## What the staging table was for, and why it was wrong

Selecting a 2.4 MB Outlook calendar export in Journal → Calendar Import failed
with Next's opaque error:

> An error occurred in the Server Components render. The specific message is
> omitted in production builds… A digest property is included

The server log said `Maximum array nesting exceeded`. That was read as "the
action returns one row per event, and a few thousand array elements exceed the
serializer's guard", so 0090 moved the parsed events into a table and had the
screen page over them.

**The diagnosis was wrong, and so were two before it.** For the record, since
each one looked convincing:

| Theory | Why it was wrong |
|---|---|
| The 4 MB `bodySizeLimit` is exceeded | 2.4 MB of text JSON-encodes at ~1.13x, well under 4 MB |
| A few thousand array elements trip the serializer | The limit is **1,000,001** slots. 500,000 objects pass |
| JSON encoding inflates the body ~1.7x | Invented. Measured 1.13x |

The actual mechanism, found by reproducing it against the installed React:

- React wraps a **multi-argument** action call in an array, and its decoder
  charges that array **one slot per character** of every string inside it. The
  limit is 1,000,001, so any file over ~1 MB of text exceeds it.
- A **single** argument is not wrapped in an array, so nothing is counted.

The same 2.4 MB file **passes alone** and **fails with a `{}` beside it**. The
second argument's type is irrelevant; a trailing `undefined` is enough. This is
why the screen failed identically before and after 0090 — both versions called
`action(fileText, filter, …)`, and neither the file's size nor the row count was
ever the problem.

Verified thresholds, one argument vs two, same file:

```
1.0 MB, 1 arg → OK      1.0 MB, 2 args → FAIL
2.4 MB, 1 arg → OK      2.4 MB, 2 args → FAIL
```

## The actual fix

The file is sent as a `FormData` blob — binary on the wire, never counted as
string slots — with the filter and presets as JSON fields. Confirmed to pass at
**20 MB**, so there is no practical ceiling. It lives in
`journal-calendar-import-actions.ts`, needs no table, and no migration.

`bodySizeLimit` was briefly raised to 32 MB chasing the first theory and has
been returned to 4 MB. A comment in `next.config.ts` records that dead end so
nobody raises it again.

## Why the history row stays

`sys_schema_migrations` keeps its `0090_create_journal_ics_staging.sql` row.
Deleting it would make the runner treat 0090 as pending and fail looking for a
file that no longer exists (`scripts/migrate.ts` applies any filename it does
not find in that table). Leaving it is also simply accurate: the migration did
run on that database.

## Idempotent by necessity

Every `DROP` is `IF EXISTS`, because this must be a no-op on a database that
never ran 0090 — which is every fresh install, and every dev database that was
not migrated during the few hours 0090 existed. Only the NAS database actually
has these objects.

## Data loss

None. The table held in-flight upload proposals only, never a source of truth —
an imported calendar event is a row in `jrn_entries`. It was verified empty
(`SELECT COUNT(*) → 0`) before this migration was written.
