-- Attendance module: teachers take daily attendance for a class.
-- No DB-level foreign keys — the repository maintains the links, per project
-- convention. Optional text fields store '' rather than NULL, the same
-- blank-not-null convention exp_* uses.

-- The roster. One row per student, independent of any class: a student is
-- enrolled into classes through att_class_enrollments, so the same person can
-- sit in several.
CREATE TABLE att_students (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name         TEXT    NOT NULL,
  last_name          TEXT    NOT NULL,
  student_identifier TEXT    NOT NULL DEFAULT '',  -- school-assigned ID; '' when unknown
  email              TEXT    NOT NULL DEFAULT '',
  note               TEXT    NOT NULL DEFAULT '',
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_att_students_last_name ON att_students (last_name, first_name);

CREATE TRIGGER att_students_set_updated_at
AFTER UPDATE ON att_students
FOR EACH ROW
BEGIN
  UPDATE att_students SET updated_at = datetime('now') WHERE id = old.id;
END;

-- A class a teacher takes attendance for.
CREATE TABLE att_classes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_att_classes_name ON att_classes (name);

CREATE TRIGGER att_classes_set_updated_at
AFTER UPDATE ON att_classes
FOR EACH ROW
BEGIN
  UPDATE att_classes SET updated_at = datetime('now') WHERE id = old.id;
END;

-- Student <-> class, many-to-many. The unique index makes enrolling an
-- already-enrolled student a no-op rather than a duplicate roster line.
CREATE TABLE att_class_enrollments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id   INTEGER NOT NULL,  -- -> att_classes.id
  student_id INTEGER NOT NULL,  -- -> att_students.id
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_att_class_enrollments_pair    ON att_class_enrollments (class_id, student_id);
CREATE INDEX        idx_att_class_enrollments_student ON att_class_enrollments (student_id);

-- One saved attendance session: a class, on a date.
--
-- UNIQUE (class_id, attendance_date) is what implements "taking attendance
-- twice for the same class on the same day overwrites the earlier record".
-- The coding guide warns against putting a DATE in a unique index, because at
-- date granularity two genuinely distinct events collide. That warning does
-- not apply here: one-record-per-class-per-day is the rule the feature is
-- specified on, so a collision is exactly the case we want the write to
-- replace rather than a second real event being dropped.
--
-- class_name is denormalized on purpose: a report printed for last term must
-- keep reading the way it did when it was taken, so renaming a class must not
-- rewrite history. Same reasoning for student_name below.
CREATE TABLE att_attendance_records (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id            INTEGER NOT NULL,  -- -> att_classes.id
  class_name          TEXT    NOT NULL,  -- the class's name as it was when taken
  attendance_date     TEXT    NOT NULL,  -- YYYY-MM-DD
  recorded_at         TEXT    NOT NULL,  -- full ISO timestamp of the save
  recorded_by_user_id INTEGER NOT NULL,  -- -> sys_users.id
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_att_attendance_records_class_date ON att_attendance_records (class_id, attendance_date);
CREATE INDEX        idx_att_attendance_records_date       ON att_attendance_records (attendance_date);

CREATE TRIGGER att_attendance_records_set_updated_at
AFTER UPDATE ON att_attendance_records
FOR EACH ROW
BEGIN
  UPDATE att_attendance_records SET updated_at = datetime('now') WHERE id = old.id;
END;

-- One student's status within a saved session. Every enrolled student gets a
-- row, present or absent, so a report can show both lists and tell "absent"
-- apart from "attendance was never taken".
CREATE TABLE att_attendance_entries (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  attendance_record_id INTEGER NOT NULL,  -- -> att_attendance_records.id
  student_id           INTEGER NOT NULL,  -- -> att_students.id
  student_name         TEXT    NOT NULL,  -- the student's name as it was when taken
  status               TEXT    NOT NULL,  -- present | absent
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_att_attendance_entries_pair   ON att_attendance_entries (attendance_record_id, student_id);
CREATE INDEX        idx_att_attendance_entries_record ON att_attendance_entries (attendance_record_id);
