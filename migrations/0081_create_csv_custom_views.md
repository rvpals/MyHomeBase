# Migration 0081: custom views for CSV Analysis

**Date:** 2026-09-04
**Type:** new table

## What this does

Adds `csv_custom_views`, a named saved query over one imported CSV dataset. A
view holds the columns to show, the criteria to filter by, the order-by list,
and a page size. The CSV Analysis module gains a *Custom Views* section to
build them; each entry on the Dashboard gains a dropdown that applies one.

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PK AUTOINCREMENT` | |
| `entry_id` | `INTEGER NOT NULL` | → `csv_analytics_entries.id`, no FK clause |
| `name` | `TEXT NOT NULL` | Unique within an entry |
| `description` | `TEXT` | Nullable — a view needs no explanation |
| `selected_columns_json` | `TEXT NOT NULL DEFAULT '[]'` | `string[]` of column names |
| `criteria_json` | `TEXT NOT NULL DEFAULT '[]'` | `{column, operator, values}[]`, ANDed |
| `order_by_json` | `TEXT NOT NULL DEFAULT '[]'` | `{column, direction}[]`, in order |
| `records_per_page` | `INTEGER NOT NULL DEFAULT 100` | |
| `is_enabled` | `INTEGER NOT NULL DEFAULT 1` | `0` hides it from the entry dropdown |

Plus `idx_csv_custom_views_entry` and the usual `updated_at` trigger.

## Why a view belongs to one entry

Criteria and order-by name columns, and a column name only means something
inside one entry's schema — `amount >= 100` is meaningless against a dataset
with no `amount`. A view floating free of an entry would either have to be
re-validated against every entry it might be applied to, or silently drop the
criteria that don't fit. Both are worse than the honest model: a view is built
against an entry and offered only there.

The cost is that two similar datasets need two views. That's accepted; cloning
a view to another entry is a later feature, not a reason to weaken the model.

## Why three JSON columns

This is the fourth table in the project to take the JSON-blob exception, on the
same grounds as `csv_chart_presets.options_json` (0022),
`jrn_saved_filters.filter_json` (0043) and `csv_analytics_entries.columns_json`
(0021):

- Each column is a **variable-shape list** whose shape the view builder defines.
- Each is **replaced wholesale** on every save — there is no partial update.
- None is **ever queried by SQL**. The repository reads the row, parses it, and
  `view-query.ts` compiles a `SELECT` from it in TypeScript.
- Normalising would mean three child tables (`..._columns`, `..._criteria`,
  `..._order_by`) that are only ever read and written as a whole tree, and every
  new operator or direction would need its own migration.

The counter-case is worth stating: if a future screen wants "which views filter
on column X?", that's a query against `criteria_json` and the blob stops paying.
At that point the criteria become a child table. Today nothing asks.

## Why records_per_page and is_enabled are columns, not blob fields

Both were candidates for a single `options_json`, and both are deliberately
out of it:

- `records_per_page` is read on **every page fetch** to build the `LIMIT` /
  `OFFSET`. A number the query planner and the repository both use directly is
  not part of a bag.
- `is_enabled` decides whether a view appears in the Dashboard dropdown, so
  `WHERE entry_id = ? AND is_enabled = 1` is a real query. Burying it in JSON
  would force the repository to read and parse every view just to filter the
  list.

`is_enabled` is an INTEGER 0/1 rather than a boolean because SQLite has no
boolean type; the repository maps it at the domain boundary, as every other
table here does.

## Why an empty selected_columns_json means "every column"

An entry can gain columns after a view is saved (`addColumns` on an
append/truncate ingest). Storing the full column list at save time would freeze
a view to the schema it was built against, so a dataset that grew a column
would keep hiding it with no indication why.

An empty array is therefore a real state meaning "all of them, whatever they
are now" — and it is what a view built without touching the column picker
stores, which is the common case. A view that *does* name columns is making a
deliberate choice and keeps it; a column that later disappears is skipped by
`compileViewQuery` rather than producing invalid SQL.

## Injection surface

`view-query.ts` compiles SQL from user-authored input, which makes it the same
risk surface as `sql-builder.ts` and it follows the same two rules:

- **Identifiers** (column names, the table name) are validated against the
  entry's real `columns_json` — an unknown name is rejected, never interpolated
  — and are still double-quoted through `quoteIdentifier` afterwards.
- **Literals** are always bound parameters, never concatenated. `LIMIT` and
  `OFFSET` are the exception SQLite forces (they can't be parameters in a
  prepared statement built this way), so both are coerced through
  `Math.floor` on a validated positive integer before reaching the string.

Operators come from a closed zod enum, so no operator text reaches SQL.

## Rollback

```sql
DROP TRIGGER IF EXISTS csv_custom_views_set_updated_at;
DROP INDEX IF EXISTS idx_csv_custom_views_entry;
DROP TABLE IF EXISTS csv_custom_views;
```
