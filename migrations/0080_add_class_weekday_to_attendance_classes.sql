-- An attendance class gains the weekday it meets on.
--
-- Until now a class knew nothing about when it met, so the home screen opened on
-- a single configured default class and a teacher taking three different classes
-- across the week picked from the dropdown every morning. The weekday is a
-- property of the *class* — "Math 101 is the Monday class" — which is why the
-- column lives here rather than on a session; a saved attendance record already
-- carries its own date and needs no help deriving the day from it.
--
-- Stored 1 = Monday through 5 = Friday, matching Date.getDay() so the home
-- screen can compare today's day number against the column with no lookup table
-- in between. Monday-to-Friday only: this is a school timetable, and a weekend
-- class is not a case the picker offers.
ALTER TABLE att_classes ADD COLUMN class_weekday INTEGER NOT NULL DEFAULT 0;

-- No back-fill, and the default is 0 rather than 1.
--
-- Monday would be a lie stored against every existing class, indistinguishable
-- from a day the teacher had actually chosen — and it would make the home screen
-- confidently open on the wrong register every Monday morning. 0 means "no
-- weekday set", a real state:
--
--   * attendanceClassSchema admits 0, so a pre-migration class stays *readable*.
--     Refusing it here would make every existing class un-loadable.
--   * createClassSchema requires 1-5, so 0 can never be *written*. Once a class
--     is saved through the form it carries a real weekday.
--   * resolveWeekdayClassId() in src/lib/attendance/weekday.ts simply skips a
--     class sitting on 0 — an unset class is never today's class, so the screen
--     falls through to the configured default instead of guessing.
--
-- The Classes grid shows such a class as "—", so the gap is visible rather than
-- silent.

-- No UNIQUE index on class_weekday. Two classes may legitimately share a
-- weekday: a teacher taking both a Monday morning and a Monday afternoon class
-- is ordinary, and a weekday does not identify a class row exactly (see
-- coding-guide.md -> "Never put a DATE column in a unique index" for the general
-- rule this follows). When several match, the home screen takes the first by
-- name and leaves the dropdown fully usable.

-- No plain index either. Every read of this column arrives with the whole class
-- list already in hand — listClasses() returns a handful of rows and the match
-- happens in TypeScript, not in SQL.

-- No CHECK constraint on the 1-5 range. createClassSchema is the only writer and
-- already applies it, which is where this module's invariants live (see
-- ARCHITECTURE.md) -- and adding a CHECK to an existing SQLite table needs the
-- full create-copy-drop rebuild, a poor trade for a bound the only writer holds.
