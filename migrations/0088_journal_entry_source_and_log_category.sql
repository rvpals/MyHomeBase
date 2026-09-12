-- Journal: where an entry came from, and the Log category.
--
-- Two related additions behind the Calendar Import section:
--
-- 1. `source` / `external_id` on jrn_entries — provenance, and the key that
--    makes re-importing the same .ics a no-op.
-- 2. A seeded `Log` category, which listTodayInHistory excludes.
--
-- Both columns are NOT NULL DEFAULT '' so every existing row and every existing
-- INSERT keeps working untouched — nothing else in the module names them.

-- '' = written by hand in the app. 'ics' = imported from an iCalendar export,
-- 'csv' = imported from a CSV. Free text with a documented set rather than a
-- CHECK constraint: adding a source later must not need a migration.
ALTER TABLE jrn_entries ADD COLUMN source TEXT NOT NULL DEFAULT '';

-- The source's own id for this entry -- for 'ics', the VEVENT's UID.
--
-- This, not date+time+title, is what the calendar import matches on. A UID is
-- stable across edits in Google Calendar, so renaming an event or moving its
-- time re-imports as the *same* entry instead of silently creating a second
-- copy. '' for anything with no external identity (everything today).
ALTER TABLE jrn_entries ADD COLUMN external_id TEXT NOT NULL DEFAULT '';

-- Covers the importer's only lookup: "is this (source, external_id) already
-- here?". Not UNIQUE -- the '' / '' pair is shared by every hand-written entry,
-- and a unique index would cap the journal at one of them.
CREATE INDEX idx_jrn_entries_source_external
  ON jrn_entries (source, external_id);

-- The recycle bin (0079) copies entry columns by name in both directions, so
-- without these two a recycled imported entry would come back with its
-- provenance stripped -- and would then re-import as a duplicate, which is
-- exactly what external_id exists to prevent.
ALTER TABLE jrn_recycled_entries ADD COLUMN source TEXT NOT NULL DEFAULT '';
ALTER TABLE jrn_recycled_entries ADD COLUMN external_id TEXT NOT NULL DEFAULT '';

-- The category the calendar import defaults to, and the one listTodayInHistory
-- filters out. Seeded here rather than left to createEntry's auto-registration
-- so it carries a description, and so it exists before the first import runs.
--
-- INSERT OR IGNORE, not INSERT: the name is the natural key (0027), and a
-- reader who has already made their own 'Log' category keeps their description.
INSERT OR IGNORE INTO jrn_categories (name, description)
VALUES ('Log', 'A logged activity rather than a written entry. Excluded from Today in History.');
