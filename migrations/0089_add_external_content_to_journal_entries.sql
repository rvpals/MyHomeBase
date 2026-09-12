-- Journal: remember what the calendar last sent, so a re-import can keep your notes.
--
-- Behind the Calendar Import screen's "Keep my own notes and edits when
-- refreshing an event" option. Without this column the importer can see only
-- the *combined* content of an entry and has no way to tell the reader's own
-- writing from the DESCRIPTION it wrote there itself -- so a refresh had to
-- replace the whole field, losing anything typed in afterwards.
--
-- With it, the split is arithmetic: whatever of the stored content is not the
-- remembered external text is the reader's, and only the external part is
-- replaced.

-- The DESCRIPTION (plus any note prefix) this importer last wrote into
-- `content`, verbatim. '' for a hand-written entry, and '' for anything
-- imported before this migration.
--
-- NOT NULL DEFAULT '' so every existing row and every existing INSERT keeps
-- working untouched -- nothing outside the calendar importer names it.
ALTER TABLE jrn_entries ADD COLUMN external_content TEXT NOT NULL DEFAULT '';

-- The recycle bin (0079) copies entry columns by name in both directions, so a
-- column missing from the mirror is silently dropped on the way in. Without
-- this, recycling an imported entry and restoring it would strip the split and
-- the next refresh would treat the whole content as the reader's -- the same
-- class of back-door failure 0088 fixed for source/external_id.
ALTER TABLE jrn_recycled_entries ADD COLUMN external_content TEXT NOT NULL DEFAULT '';

-- No index. This column is never a search key: it is read only via the entry
-- the importer has already found by (source, external_id), which
-- idx_jrn_entries_source_external already covers.
