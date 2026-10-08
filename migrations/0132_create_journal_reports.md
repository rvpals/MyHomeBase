# Migration 0132: Journal Reports

**Date:** 2026-10-07
**Type:** two new tables, three indexes, six seeded reports

## What this does

| Object | Change |
|---|---|
| `jrn_reports` | **created** — one row per report (the header) |
| `jrn_report_details` | **created** — the HTML template, up to three parts per report |
| `idx_jrn_report_details_report` | **created** — lookup by report |
| `idx_jrn_report_details_report_part` | **created**, UNIQUE on `(report_id, part)` |
| 6 rows in `jrn_reports` | **seeded**, `is_builtin = 1` |
| 16 rows in `jrn_report_details` | **seeded** — the templates for those six |

Nothing existing is touched. No column on `jrn_entries` changes, and no other
table is read or written. Re-runnable in shape (`IF NOT EXISTS` throughout), but
the seed `INSERT`s are not guarded — the migration runner records 0132 in
`sys_schema_migrations` and skips it thereafter, which is what prevents a second
set of seed rows.

## Why a header table and a detail table

A report is *identity + selection* (the header) and *presentation* (the details).
Splitting them means the HTML can grow to three parts — `header`, `row`,
`footer` — without three wide columns on the header table, and the `row` part can
be absent entirely for an aggregate report.

The template is stored, **not** the rendered output. Storing finished HTML would
freeze a snapshot that never reflects entries written later; storing a template
means one stored report × live journal data stays current. That is the whole
reason this is a template language rather than a cache.

## Entry selection: two modes, three columns

| `where_mode` | Column used | Who can use it |
|---|---|---|
| `filter` (default) | `where_query` | anyone with Journal access |
| `sql` | `where_sql` | **administrators only** |

`filter` mode holds the compact filter-query syntax already used by the Entries
section's `?filter=` parameter — `category = TRIP and date >= 2026-01-01`. It is
parsed by `parseFilterQuery` and compiled by `buildFilterSql`, where field names
index the fixed `FIELD_COLUMNS` allowlist. **Nothing user-typed reaches SQL as an
identifier**, and a malformed query is a reported error rather than a silent
match-everything.

`sql` mode holds a bare boolean expression spliced into the `WHERE`, for the full
expressiveness the filter syntax can't reach (subqueries, `HAVING`, date
functions). It is gated three ways:

1. The editor only shows the mode toggle to an administrator.
2. `saveJournalReportAction` calls `requireAdmin()` when the mode is `sql` — the
   UI gate is not the protection, because a server action is its own POST
   endpoint.
3. `assertReadOnlyFragment` (`src/lib/journal-reports/sql-guard.ts`) rejects
   semicolons, comment markers (`--`, `/*`) and any DDL/DML keyword, **on save
   and again on run**. A fragment that reached the table by some other route
   still cannot execute.

**Two columns rather than one shared column** is deliberate: switching modes in
the editor must not destroy the other mode's text, and a mode flag over a single
column would leave "which syntax is in here" ambiguous at read time.

## Encrypted entries are excluded by the runner

An encrypted entry (migration 0131) has `title = ''` and `content = ''`, so it
would print as a blank row. Both modes get `AND e.is_encrypted = 0` appended **in
code, by the runner** — not written by the report author. Putting it in the
template would mean every author had to remember it, and forgetting it produces a
report with silent blank rows rather than an error.

This matches how search, word stats, duplicate detection and the importer's match
key already treat encrypted entries.

## The six seeded reports

| Report | Shape | Why |
|---|---|---|
| Year in Review | aggregate + per-entry | the headline numbers, then the entries |
| Writing Activity | **aggregate only** | "entries per month" can't be a repeated row |
| Category & Tag Usage | **aggregate only** | counts per name, not per entry |
| Entry Log | per-entry | the plainest printable list |
| Locations Visited | aggregate + per-entry | most-visited, then every mention |
| Word Trends | **aggregate only** | a ranking, not a list of entries |

The three aggregate-only reports carry no `row` part. They use `{{stat.*}}` and
`{{table.*}}` placeholders, which the renderer fills once. This is the limit
flagged when the feature was planned: a `{{field}}`-per-entry template cannot
express a monthly rollup, so those reports use prebuilt tables instead of
pretending a row repeat would work.

`is_builtin = 1` makes these six **editable but not deletable**, so the starter
set can't be lost. The flag is enforced in the use-case, not by a constraint —
deleting a builtin is a refused operation with a message, not a foreign-key error.

## Rollback

```sql
DROP TABLE IF EXISTS jrn_report_details;
DROP TABLE IF EXISTS jrn_reports;
DELETE FROM sys_schema_migrations WHERE name LIKE '0132%';
```

Dropping the detail table first respects the `REFERENCES` direction. No other
table holds a reference to either of these, so nothing else needs repair.
