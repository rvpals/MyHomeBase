-- Attendance: pre-defined per-student actions recorded alongside a register.
--
-- A teacher marking the register also wants to note things about individual
-- students on the day -- "arrived late", "went up to the board and earned extra
-- credit". Those are a small, teacher-editable catalog of facts, not free text,
-- so they get a catalog table and a join table rather than a note column: a
-- code can then be counted, filtered and reported on.
--
-- No DB-level foreign keys -- the repository maintains the links, per project
-- convention. Optional text fields store '' rather than NULL, matching the rest
-- of att_*.

-- The catalog. What actions exist, what they are called, and how they draw.
--
-- `code` is the short form a report shows (L, EC). Unique NOCASE, because "l"
-- and "L" are the same code to a teacher and two rows differing only in case
-- would be indistinguishable in a chip.
--
-- `icon` is a key into ATTENDANCE_ACTION_ICONS (src/lib/attendance/action-icons.ts),
-- a small hand-drawn set local to this module -- deliberately NOT a module or
-- tree icon concept, because adding one of those means drawing it for the
-- classic set and naming candidates for all 12 generated sets. A teacher-editable
-- list needs a fixed menu of glyphs it can pick from without a code change.
--
-- `is_active` retires an action without deleting it: once an action has been
-- recorded against a session, its catalog row is the only place the icon and
-- description live, so a hard delete would leave past sessions half-described.
-- The repository hard-deletes only a row that has never been used.
CREATE TABLE att_student_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,             -- "Late", "Extra Credit"
  code        TEXT    NOT NULL,             -- "L", "EC" -- what a report shows
  description TEXT    NOT NULL DEFAULT '',
  icon        TEXT    NOT NULL DEFAULT '',  -- key into ATTENDANCE_ACTION_ICONS; '' draws nothing
  sequence    INTEGER NOT NULL DEFAULT 0,   -- order in the picker
  is_active   INTEGER NOT NULL DEFAULT 1,   -- 0 = retired, kept for history
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_att_student_actions_code ON att_student_actions (code COLLATE NOCASE);
CREATE INDEX        idx_att_student_actions_order ON att_student_actions (sequence, name COLLATE NOCASE);

CREATE TRIGGER att_student_actions_set_updated_at
AFTER UPDATE ON att_student_actions
FOR EACH ROW
BEGIN
  UPDATE att_student_actions SET updated_at = datetime('now') WHERE id = old.id;
END;

-- Which actions a student picked up in one saved session.
--
-- A join table rather than a column on att_attendance_entries: a student can be
-- late AND earn extra credit in the same lesson, so this is many-to-many by
-- nature. Keyed on (attendance_record_id, student_id) rather than on the entry's
-- id so it reads the same way the entries do -- both hang off the record.
--
-- action_code and action_name are denormalized for the same reason class_name and
-- student_name are on the tables 0047 created: a report printed last term must
-- keep reading the way it did then, so renaming "Extra Credit" must not rewrite
-- history. The action_id is kept as well, for counting current actions across
-- sessions where the catalog row still exists.
CREATE TABLE att_attendance_entry_actions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  attendance_record_id INTEGER NOT NULL,  -- -> att_attendance_records.id
  student_id           INTEGER NOT NULL,  -- -> att_students.id
  action_id            INTEGER NOT NULL,  -- -> att_student_actions.id
  action_code          TEXT    NOT NULL,  -- the code as it was when recorded
  action_name          TEXT    NOT NULL,  -- the name as it was when recorded
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One row per action per student per session. Recording the same action twice in
-- one session is a caller bug, not a second fact.
CREATE UNIQUE INDEX idx_att_attendance_entry_actions_triple
  ON att_attendance_entry_actions (attendance_record_id, student_id, action_id);

-- Every read is "the actions in this session" (the report, the sheet's history).
CREATE INDEX idx_att_attendance_entry_actions_record
  ON att_attendance_entry_actions (attendance_record_id);

-- "How many times was this student late this term" crosses sessions, so it needs
-- its own index -- the one above is keyed on the record and can't serve it.
CREATE INDEX idx_att_attendance_entry_actions_student
  ON att_attendance_entry_actions (student_id, action_id);

-- The two actions the feature ships with. Seeded here rather than left to the
-- teacher because an empty catalog makes the new button on the register look
-- broken on first use.
INSERT INTO att_student_actions (name, code, description, icon, sequence) VALUES
  ('Late',         'L',  'Being late to class.', 'turtle',      1),
  ('Extra Credit', 'EC', 'Did extra credit work today, like going up to the board to solve a problem.', 'dollar-plus', 2);
