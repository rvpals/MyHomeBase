-- Pinning for the Code Library.
--
-- A column on `cod_snippets`, not a table: a pin is one bit about the snippet
-- itself, exactly as `clp_clips.is_pinned` is (migration 0157).
--
-- SHARED, NOT PER-READER, for the same reason Clips' is: there is no per-user
-- snippet, so there is no per-user pin. Everyone granted the module sees the same
-- library and the same pinned band. A per-reader pin would need its own table
-- keyed by user, and nothing in this module is owned by one person.
--
-- The ordering this feeds lives in the repository's single ORDER BY, so the list
-- and any later board view inherit it and cannot disagree about where a pinned
-- snippet sits.
ALTER TABLE cod_snippets ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;

-- The list's order, with the pin leading it. Replaces the index 0178 created:
-- that one indexed `(updated_at DESC, id DESC)`, which no longer matches the
-- query now that every read sorts by the pin first.
DROP INDEX IF EXISTS idx_cod_snippets_updated;

CREATE INDEX idx_cod_snippets_order
  ON cod_snippets (is_pinned DESC, updated_at DESC, id DESC);
