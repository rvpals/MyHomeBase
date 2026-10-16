-- Adds the six answer-sheet option columns to cls_exams.
--
-- WHY THIS IS A SEPARATE MIGRATION AND NOT AN EDIT TO 0145
--
-- 0145 was applied to the live database on 2026-10-13 at 16:12, creating cls_exams
-- WITHOUT these columns. The .sql file was then edited to add them. A migration that
-- is already recorded in sys_schema_migrations is skipped on every later run, so the
-- 22:15 deploy printed "No pending migrations" and the table on disk kept the old
-- shape, while the code shipped in that same deploy queried the new one. The result
-- was `SqliteError: no such column: e.print_student_names` on every render of
-- /modules/classroom/exam, which is the error in app.log.
--
-- Editing 0145 again would change nothing on any database that has already run it —
-- that is the whole point of the applied-migrations tracker. An already-applied
-- migration is history; a new file is the only way to move a live schema forward.
--
-- 0145 HAS BEEN REVERTED TO MATCH WHAT IT ACTUALLY CREATED, so these columns are
-- defined in exactly one place: here. That is what makes the two paths agree without
-- any conditional SQL, which SQLite could not express anyway -- there is no
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS, and scripts/migrate.ts runs each file
-- with a bare db.exec(), so a duplicate column would abort the whole run.
--
--   fresh database:  0145 (10 columns) -> 0146 (+6) = 16
--   live database:   0145 already ran  -> 0146 (+6) = 16
--
-- Identical either way. Do not re-add these columns to 0145.
--
-- Additive only. cls_exams holds real rows (1 exam, 30 key rows at the time of
-- writing), so this must never drop or recreate the table; ALTER TABLE ADD COLUMN
-- with a NOT NULL DEFAULT backfills every existing row with that default, which is
-- the correct reading for an exam created before these options existed: no names
-- printed, no signature line, no professor, no declaration.

-- Print one sheet per enrolled student, with the student's name already on it.
-- When 0, blank name lines are printed and the count is typed at print time.
ALTER TABLE cls_exams ADD COLUMN print_student_names INTEGER NOT NULL DEFAULT 0;

-- A signature line in the sheet header.
ALTER TABLE cls_exams ADD COLUMN include_signature INTEGER NOT NULL DEFAULT 0;

ALTER TABLE cls_exams ADD COLUMN include_professor INTEGER NOT NULL DEFAULT 0;

-- Blank, never NULL, per the project convention. Carries a value only when
-- include_professor is 1; kept when the flag is turned off so toggling it back on
-- does not lose what was typed.
ALTER TABLE cls_exams ADD COLUMN professor_name TEXT NOT NULL DEFAULT '';

ALTER TABLE cls_exams ADD COLUMN include_declaration INTEGER NOT NULL DEFAULT 0;

-- The declaration text, printed as a block just above the answer grid. Free text
-- rather than a fixed sentence: the wording is the institution's, not this app's.
-- Same keep-on-toggle-off reasoning as professor_name.
ALTER TABLE cls_exams ADD COLUMN declaration_text TEXT NOT NULL DEFAULT '';
