# Migration 0043: create journal saved filters

**Date:** 2026-08-14
**Type:** new table
**Table(s) affected:** `jrn_saved_filters` (created)

## What this does

Backs the new **Entries** section of My Journal. A user builds a set of
conditions ("category is Travel, and the title contains trip"), gives it a name,
and saves it; the Entries screen offers saved filters in a dropdown, applies the
selected one to the result list, and shows its criteria back in a collapsible
card.

| Column | Type | Notes |
|---|---|---|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | |
| `name` | `TEXT NOT NULL` | What the user picks from the dropdown. `UNIQUE` — see below. |
| `filter_json` | `TEXT NOT NULL` | The condition tree. See the JSON exception below. |
| `created_at` | `TEXT NOT NULL DEFAULT (datetime('now')))` | |
| `updated_at` | `TEXT NOT NULL DEFAULT (datetime('now')))` | Maintained by `jrn_saved_filters_set_updated_at`. |

## Why `UNIQUE (name)` — the chart-preset shape, not the named-mapping shape

The app has two precedents for a named, user-saved entity and they disagree:

- `csv_named_mappings` (0019) allows **duplicate names** and has separate
  `createNamedMapping` / `updateNamedMapping` paths.
- `csv_chart_presets` (0022) has **`UNIQUE (entry_id, name)`**, which makes save a
  single `INSERT ... ON CONFLICT DO UPDATE` upsert-by-name.

This table follows the chart-preset shape. It is the newer of the two, one
`saveFilter` use-case is simpler than a create/update pair, and for something
selected from a dropdown two identically-named filters would be a UI defect
rather than a feature — the user could not tell them apart.

Consequence to know: saving under an existing name **overwrites** it rather than
adding a second. That is the intended behaviour, and it is also why the builder
UI shows the name it is about to write.

## Deliberate exception: `filter_json`

A JSON column is a flagged exception in `coding-guide.md`, so the grounds, on the
same footing as `csv_chart_presets.options_json` (0022),
`csv_named_mappings.column_mapping_json` (0019) and
`csv_analytics_entries.columns_json` (0021):

- **Variable shape, defined by the UI.** A filter is one level of AND/OR groups,
  each holding N conditions, and a condition's `value` is a string, a date, a
  boolean or a pair of bounds depending on its `field` and `operator`. There is no
  single column set that fits all of them.
- **Replaced wholesale on save.** Nothing ever updates one condition in place.
- **Never queried by SQL.** No query filters or joins on the contents. The
  repository reads the row, parses the tree, and compiles a parameterized
  `WHERE` clause in code (`src/lib/journal/filters.ts`).
- **Normalizing it would cost two child tables** (`jrn_filter_groups`,
  `jrn_filter_conditions`) that are only ever read and written as a whole tree,
  and every new condition type would then need its own migration.

Kept as JSON, a new field family costs nothing at the schema level. **GPS /
location conditions are anticipated and deliberately not built in this change** —
when they arrive, this table does not change.

## The obligation this carries

Because the column is opaque to SQL, correctness moves into code, and that is
where it has to be enforced:

- `filterSchema` in `src/lib/journal/schema.ts` validates the tree on the way in
  **and on the way out** — a row hand-edited in the DB, or written by an older
  version of the app, must not crash the Entries screen.
- Reads use the **widening-envelope** pattern already established by
  `parseStoredMapping` in `src/lib/csv-import/mapping.ts`: tolerate older stored
  shapes, always write the newest. A filter that fails to parse is reported as
  unreadable rather than throwing.
- `buildFilterSql` emits **named parameters only** and never interpolates a user
  value into SQL text. Field names are mapped through a fixed allowlist to column
  names — a `field` arriving from JSON is never used as an identifier directly.

## No seed data

Starts empty. With no saved filters the Entries screen lists all entries
unfiltered, which is the same thing the dropdown's "All entries" option does.

## Rollback

```sql
DROP TRIGGER IF EXISTS jrn_saved_filters_set_updated_at;
DROP TABLE IF EXISTS jrn_saved_filters;
```
