-- Attendance: a class may be registered more than once in a day.
--
-- 0047 made (class_id, attendance_date) UNIQUE, which implemented
-- "re-taking attendance overwrites the day". That is no longer the behaviour:
-- each save is now its own session, so a class that meets twice keeps two
-- records. Dropping the unique index is the whole change.
--
-- This also retires the standing exception 0047 added to coding-guide.md. With
-- the index gone the general rule ("a unique index may only span columns that
-- identify the row exactly") applies to this table with no carve-out, because
-- a date plainly does not identify a session.

-- Non-unique replacement: every per-class-per-day read still needs an index to
-- ride, it just must not reject the second session.
DROP INDEX IF EXISTS idx_att_attendance_records_class_date;
CREATE INDEX idx_att_attendance_records_class_date
  ON att_attendance_records (class_id, attendance_date);

-- A readable HH:MM for the session, so the picker that now has to distinguish
-- "09:05" from "14:10" doesn't re-parse a timestamp at every call site.
-- Derived from recorded_at rather than being a second source of truth.
ALTER TABLE att_attendance_records ADD COLUMN session_label TEXT NOT NULL DEFAULT '';

-- Backfill the rows written before this column existed. recorded_at is a full
-- ISO timestamp (see saveAttendance), so the HH:MM sits at offset 11.
UPDATE att_attendance_records
SET session_label = substr(recorded_at, 12, 5)
WHERE session_label = ''
  AND length(recorded_at) >= 16;
