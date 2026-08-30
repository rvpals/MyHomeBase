-- Index the NAME side of the journal's two entry<->taxonomy join tables.
--
-- Both tables already have an index led by entry_id -- the UNIQUE
-- (entry_id, name) from 0027 plus a plain entry_id index. That serves
-- "which tags does this entry have", which is the hydration direction.
-- It cannot serve the opposite direction, because name is not a prefix
-- of any existing index: SQLite can only seek on a leading column.
--
-- Three query shapes read by name and were doing a full table scan:
--
--   1. listTopTags / listTopCategories -- GROUP BY tag_name. Without an
--      index this scans every pairing row and builds a temporary B-tree to
--      group it, on every dashboard render. With one, the index is already
--      in name order and the grouping is a walk.
--   2. deleteTag / deleteCategory -- DELETE ... WHERE tag_name = ?, a scan
--      per delete.
--   3. The hasAny / hasNone filter conditions, whose EXISTS subquery rides
--      entry_id to find the entry's rows but then compares tag_name
--      unindexed.
--
-- This is the trap coding-guide.md describes from the other side: 0027 added
-- a leading entry_id column and the "find by name" direction quietly lost its
-- index prefix. The fix is a second index, not a change to the first -- the
-- UNIQUE constraint's column order is load-bearing for hydration.
--
-- Pure additions: no table is rebuilt, no column changes, and nothing needs
-- back-filling. SQLite populates each index from the existing rows as it is
-- created.

CREATE INDEX IF NOT EXISTS idx_jrn_entry_tags_tag_name
  ON jrn_entry_tags (tag_name);

CREATE INDEX IF NOT EXISTS idx_jrn_entry_categories_category_name
  ON jrn_entry_categories (category_name);
