# Migration 0047: create the Attendance tables

**Date:** 2026-08-16
**Type:** schema (five new tables, no changes to existing ones)

## What this does

Creates the storage for the Attendance module, where a teacher takes daily
attendance for a class.

| Table | Holds | Notes |
|---|---|---|
| `att_students` | The roster | Name required; student ID, email and note optional (`''`, not NULL) |
| `att_classes` | A class | `name` is unique |
| `att_class_enrollments` | Student ↔ class | Many-to-many; unique on the pair |
| `att_attendance_records` | One saved session | Unique on `(class_id, attendance_date)` |
| `att_attendance_entries` | One student's status in a session | `present` or `absent` |

New module prefix: **`att_`**.

## Two decisions worth recording

### A date *is* in a unique index here, deliberately

`coding-guide.md` says never to put a DATE column in a unique index, because at
date granularity two genuinely distinct events look identical and the second is
silently dropped — that rule came out of `stk_stock_transactions` rejecting a
second lot bought the same day.

`UNIQUE (class_id, attendance_date)` is the intended exception, and the reason
the rule doesn't bite is that here there is no such thing as a second distinct
event: the module is specified as one attendance record per class per day, and
re-taking attendance **overwrites** that day's record. So a collision is not a
real second event being lost, it is precisely the case the write is supposed to
replace. `saveAttendance` deletes the existing record and its entries and
re-inserts, inside one transaction.

If the module ever needs to support a class meeting twice in one day, this index
is the thing to drop — not to add a column to.

### `class_name` and `student_name` are denormalized

Both are stored on the saved record in addition to the id. A report printed for
last term has to keep reading the way it did when it was taken, so renaming a
class or correcting a student's spelling must not rewrite history. The ids stay
for joining to the live rows; the names are the historical record.

Per the project's database-design standards, denormalization is flagged rather
than assumed — this was raised in the plan and approved.

## Indexes

| Index | On | Why |
|---|---|---|
| `idx_att_students_last_name` | `att_students (last_name, first_name)` | The roster lists alphabetically |
| `idx_att_classes_name` | `att_classes (name)` — unique | Two classes with one name can't be told apart in a picker |
| `idx_att_class_enrollments_pair` | `(class_id, student_id)` — unique | Re-enrolling is a no-op, not a duplicate |
| `idx_att_class_enrollments_student` | `(student_id)` | "Which classes is this student in?" |
| `idx_att_attendance_records_class_date` | `(class_id, attendance_date)` — unique | Enforces one record per class per day |
| `idx_att_attendance_records_date` | `(attendance_date)` | The report reads by date |
| `idx_att_attendance_entries_pair` | `(attendance_record_id, student_id)` — unique | One status per student per session |
| `idx_att_attendance_entries_record` | `(attendance_record_id)` | Reading a session's entries |

## Rollback

```sql
DROP TABLE IF EXISTS att_attendance_entries;
DROP TABLE IF EXISTS att_attendance_records;
DROP TABLE IF EXISTS att_class_enrollments;
DROP TABLE IF EXISTS att_classes;
DROP TABLE IF EXISTS att_students;
```
