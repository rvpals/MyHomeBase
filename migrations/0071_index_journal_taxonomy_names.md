# Migration 0071: index the journal taxonomy join tables by name

**Date:** 2026-08-29
**Type:** additive index

## What this does

Adds one index to each of the journal's entry↔taxonomy join tables, on the
*name* column:

| Index | Table | Column |
|---|---|---|
| `idx_jrn_entry_tags_tag_name` | `jrn_entry_tags` | `tag_name` |
| `idx_jrn_entry_categories_category_name` | `jrn_entry_categories` | `category_name` |

Both are plain `CREATE INDEX IF NOT EXISTS`. No table is rebuilt, no column
changes, nothing is back-filled.

## Why the existing indexes could not serve these queries

Migration 0027 gave each join table two indexes, both led by `entry_id`:

```sql
CREATE UNIQUE INDEX idx_jrn_entry_tags_unique ON jrn_entry_tags (entry_id, tag_name);
CREATE INDEX idx_jrn_entry_tags_entry_id ON jrn_entry_tags (entry_id);
```

That covers the *hydration* direction — "which tags does entry 42 have" — which
is how an entry is read. It cannot cover the opposite direction, because SQLite
can only seek on a **leading** index column and `tag_name` is not one. A query
filtering or grouping by name had to scan the whole table.

This is exactly the failure mode `coding-guide.md` warns about, seen from the
other side: adding a leading `entry_id` column silently removed the prefix that
a "find by name" query would have relied on. The answer is a second index rather
than a reordering of the first — the `UNIQUE (entry_id, tag_name)` column order
is load-bearing, both for the constraint's meaning and for hydration.

## The three query shapes this fixes

1. **`listTopTags` / `listTopCategories`** — `GROUP BY tag_name`. This is the
   most valuable of the three because it runs on **every dashboard render**.
   `EXPLAIN QUERY PLAN` before and after:

   ```
   before:  SCAN jrn_entry_tags
            USE TEMP B-TREE FOR GROUP BY
            USE TEMP B-TREE FOR ORDER BY
   after:   SCAN jrn_entry_tags USING COVERING INDEX idx_jrn_entry_tags_tag_name
            USE TEMP B-TREE FOR ORDER BY
   ```

   The index is already in `tag_name` order, so grouping becomes a walk and that
   temp B-tree disappears; it is also *covering*, so the query never touches the
   table itself. The remaining temp B-tree is for `ORDER BY entryCount DESC` —
   sorting by the aggregate, which no index on `tag_name` can serve and which
   this migration does not claim to fix.
2. **`deleteTag` / `deleteCategory`** — `DELETE ... WHERE tag_name = ?`, one full
   scan per delete, now a seek:
   `SEARCH jrn_entry_tags USING INDEX idx_jrn_entry_tags_tag_name (tag_name=?)`.
3. **The `hasAny` / `hasNone` filter conditions** — the `EXISTS` subquery in
   `buildFilterSql` rides `entry_id` to locate an entry's pairing rows but then
   compares `tag_name` unindexed.

## Why write-cost is not a concern here

Each index adds a B-tree insert per pairing row written. Pairing rows are only
written when an entry is created or its taxonomy edited — a handful of rows per
save, by one person. The read side runs on every dashboard load. The trade is
lopsided in the read's favour.

## What this migration deliberately does not do

- **No index on `jrn_entries.is_pinned`.** One already exists from 0027 and
  indexes a column no query filters or orders by; a two-value boolean is a poor
  index candidate regardless. Removing it, or making it a partial index, belongs
  with the work that actually builds a pinned-entries reader — not here.
- **No `NOCASE` collation.** These indexes match the columns' declared
  collation (BINARY) so the planner can actually use them for the `=` and
  `GROUP BY` above. Case-insensitive taxonomy matching is a separate question
  about the *columns*, and changing a column's collation means a table rebuild.
- **No foreign keys.** Per project convention the repository maintains these
  links; 0027 says so explicitly and that has not changed.

## Rollback

```sql
DROP INDEX IF EXISTS idx_jrn_entry_tags_tag_name;
DROP INDEX IF EXISTS idx_jrn_entry_categories_category_name;
```

Dropping an index cannot lose data — it only returns those queries to a scan.
