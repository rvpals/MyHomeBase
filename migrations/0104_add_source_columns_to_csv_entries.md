# Migration 0104: source columns on a CSV entry

**Date:** 2026-09-22
**Type:** one added column

## What this does

Adds `csv_analytics_entries.source_columns_json` — which of an entry's columns record
*where a pooled row came from* rather than carrying a measurement the file supplied.

This is the storage behind **CSV Analysis → Import Files**: dropping several
same-shaped CSVs (all humidity meters, say) into one dataset, with each row tagged with
the file it came from plus one or two labels the reader typed for that file
("Bathroom", "Basement"). **CSV Analysis → Compare** then groups by one of those
columns to answer "combine every device: what is the average, which one is highest".

```json
[
  { "name": "_source_file", "kind": "file",  "label": "Source file" },
  { "name": "room",         "kind": "label", "label": "Room" }
]
```

## Why the source is a real column, not a side table

The decision worth recording. A pooled row's origin is stored as an **ordinary column
on the entry's own physical table**, and this JSON only records *which* columns those
are.

The alternative — a `csv_row_sources` join table keyed by rowid — was rejected because
every feature the module already has reads the entry's columns: custom views compile
criteria against them ([view-query.ts](../src/lib/csv-analytics/view-query.ts)), the
chart builder picks axes from them, bulk edit writes them, and the grid exports them.
Making the source one of those columns means all of that works on it **with no change
to any of them**. A join table would have meant reworking the view compiler and the
repository's read path to carry a join, for no gain the reader can see.

The cost is that a source column is editable like any other, and can be dropped by an
Overwrite. That is handled rather than prevented: `groupableSourceColumns` filters the
recorded list against the entry's real columns at read time, so a dataset whose label
column was dropped degrades to grouping by filename instead of throwing — the same
read-time forgiveness a custom view gives a missing column.

## Nothing existing changes

The column is nullable with no default and **no backfill**, because there is nothing to
backfill: every entry that exists today was a single-file import, which by definition
has no source columns. The repository's mapper reads NULL as `[]`, so an old entry
reports `sourceColumns: []` and behaves exactly as it did before. `sourceColumns.length
> 0` is therefore the whole test for "is this a pooled dataset".

Two paths deliberately clear it back to NULL:

- **Overwrite** (`overwriteEntry`) redefines the whole schema from one dropped file, so
  any recorded source columns would name columns that no longer exist.
- A plain single-file **create** never sets it.

## A pooled table uses the surrogate key

`createPooledEntry` always passes `primaryKeyFields: []`, so the table gets the
`_row_id INTEGER PRIMARY KEY AUTOINCREMENT` surrogate. This is forced, not a default:
several devices legitimately report the *same timestamp*, so any primary key over the
data columns would make one device's reading collide with another's.

That is also why `appendPooledRows` uses a plain `INSERT` rather than the
`INSERT OR IGNORE` that `appendRows` uses. OR IGNORE would turn such a collision into a
silently skipped row — losing a whole device's readings while reporting success — and
silent loss is the exact failure this feature exists to prevent.

## Rollback

```sql
ALTER TABLE csv_analytics_entries DROP COLUMN source_columns_json;
```

Safe on the schema, but it orphans any pooled dataset: the source columns stay in the
physical table as ordinary text columns, and Compare stops offering to group by them.
The rows and their tags are not lost — only the knowledge of which columns they are.
