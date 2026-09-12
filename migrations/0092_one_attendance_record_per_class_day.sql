-- Attendance: one register per class per day, and session labels on the local clock.
--
-- This reverses 0049 ("a class may be registered more than once in a day") and
-- restores the rule 0047 shipped with. The behaviour asked for is: opening a
-- class from the home screen loads whatever was saved last time, editing and
-- saving again UPDATES that record rather than adding a second one.
--
-- Two separate things are fixed here. They look unrelated but they compounded:
-- because every session_label was written from the UTC clock, an evening
-- register showed a nonsense time, which invited a re-save -- and every re-save
-- appended another row. Hence three class/dates carrying up to four "sessions"
-- in the deployed database.
--
-- No BEGIN/COMMIT: scripts/migrate.ts already wraps each file in a transaction,
-- so opening one here would fail.

-- ---------------------------------------------------------------------------
-- 1. Merge the duplicate registers
-- ---------------------------------------------------------------------------
--
-- The survivor per (class_id, attendance_date) is the newest recorded_at, which
-- is the same "latest wins" rule the detail grid already applied when it
-- collapsed a doubly-registered day into one column.
--
-- Merged rather than simply deleted, deliberately: these rows are not two real
-- registers, they are one register saved several times against a misleading
-- clock. A student ticked at 22:31 and missed at 22:58 was present that day, so
-- presence is unioned across the day's rows instead of taking only the last
-- sitting's word for it. That is lossy in one direction -- if a class genuinely
-- met twice and a student attended only the morning, they now read as present
-- for the merged day -- which is accepted here because the affected rows are
-- known (3 class/dates, all minutes-apart re-saves except 2026-08-17) and
-- because losing an attendance is worse than over-recording one.

CREATE TEMPORARY TABLE att_0092_survivor AS
SELECT
  class_id,
  attendance_date,
  -- Ties on recorded_at break on id, so the survivor is always exactly one row.
  (SELECT r2.id
     FROM att_attendance_records r2
    WHERE r2.class_id = r1.class_id
      AND r2.attendance_date = r1.attendance_date
    ORDER BY r2.recorded_at DESC, r2.id DESC
    LIMIT 1) AS keep_id
FROM att_attendance_records r1
GROUP BY class_id, attendance_date;

-- Every (student, status) the day saw anywhere, with present winning over absent.
-- student_name comes from the newest row that names that student, so the name is
-- the most recent one captured rather than an arbitrary pick.
CREATE TEMPORARY TABLE att_0092_merged_entry AS
SELECT
  s.keep_id                                 AS attendance_record_id,
  e.student_id                              AS student_id,
  (SELECT e2.student_name
     FROM att_attendance_entries e2
     JOIN att_attendance_records r2 ON r2.id = e2.attendance_record_id
    WHERE r2.class_id = s.class_id
      AND r2.attendance_date = s.attendance_date
      AND e2.student_id = e.student_id
    ORDER BY r2.recorded_at DESC, r2.id DESC
    LIMIT 1)                                AS student_name,
  -- MAX over the text: 'present' > 'absent' alphabetically, so this is "present
  -- if present anywhere". Spelled out rather than relying on that coincidence.
  CASE WHEN MAX(CASE WHEN e.status = 'present' THEN 1 ELSE 0 END) = 1
       THEN 'present' ELSE 'absent' END     AS status
FROM att_attendance_entries e
JOIN att_attendance_records r ON r.id = e.attendance_record_id
JOIN att_0092_survivor     s ON s.class_id = r.class_id
                            AND s.attendance_date = r.attendance_date
GROUP BY s.keep_id, e.student_id;

-- The union of actions noted across the day's rows, one row per student+action.
CREATE TEMPORARY TABLE att_0092_merged_action AS
SELECT DISTINCT
  s.keep_id      AS attendance_record_id,
  a.student_id   AS student_id,
  a.action_id    AS action_id,
  a.action_code  AS action_code,
  a.action_name  AS action_name
FROM att_attendance_entry_actions a
JOIN att_attendance_records r ON r.id = a.attendance_record_id
JOIN att_0092_survivor     s ON s.class_id = r.class_id
                            AND s.attendance_date = r.attendance_date;

-- Clear the day's entries and rewrite them from the merge. Neither child table
-- declares a FOREIGN KEY, so nothing cascades and every delete is explicit.
DELETE FROM att_attendance_entries;
DELETE FROM att_attendance_entry_actions;

INSERT INTO att_attendance_entries
  (attendance_record_id, student_id, student_name, status)
SELECT attendance_record_id, student_id, student_name, status
FROM att_0092_merged_entry;

INSERT INTO att_attendance_entry_actions
  (attendance_record_id, student_id, action_id, action_code, action_name)
SELECT attendance_record_id, student_id, action_id, action_code, action_name
FROM att_0092_merged_action;

-- The non-survivors are now empty shells; drop them.
DELETE FROM att_attendance_records
WHERE id NOT IN (SELECT keep_id FROM att_0092_survivor);

DROP TABLE att_0092_survivor;
DROP TABLE att_0092_merged_entry;
DROP TABLE att_0092_merged_action;

-- ---------------------------------------------------------------------------
-- 2. Correct the UTC session labels
-- ---------------------------------------------------------------------------
--
-- Every surviving label was sliced out of a UTC ISO timestamp, so an 18:23 local
-- register reads "22:23". recorded_at is a valid instant, so the right label is
-- recoverable exactly: SQLite's 'localtime' modifier converts it using the
-- machine's timezone -- the same clock todayIsoLocal() reads when it writes
-- attendance_date, which is the point. Both now come from one clock.
--
-- Guarded on length so a malformed timestamp is left alone rather than turned
-- into an empty label.
UPDATE att_attendance_records
SET session_label = strftime('%H:%M', recorded_at, 'localtime')
WHERE length(recorded_at) >= 16
  AND strftime('%H:%M', recorded_at, 'localtime') IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Make the rule enforceable
-- ---------------------------------------------------------------------------
--
-- Back to UNIQUE, which is what makes the upsert in repository.saveAttendance
-- safe: without it a race between two saves could still write two rows for a
-- day, and the "edit the day's register" behaviour would silently break again.
--
-- This re-instates the carve-out 0049 retired from coding-guide.md. The guide
-- forbids a DATE in a unique index because at date granularity two genuinely
-- distinct events collide. That is exactly the collision wanted here:
-- one-register-per-class-per-day is the rule the feature is specified on, so a
-- second write is a correction to apply, not a second event to keep.
DROP INDEX IF EXISTS idx_att_attendance_records_class_date;
CREATE UNIQUE INDEX idx_att_attendance_records_class_date
  ON att_attendance_records (class_id, attendance_date);
