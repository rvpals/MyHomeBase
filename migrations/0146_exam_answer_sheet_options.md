# Migration 0146: exam answer-sheet options

**Date:** 2026-10-13
**Type:** add columns (6, all to `cls_exams`)

## What this does

Adds the six answer-sheet option columns to `cls_exams`:

| Column | Type | Default | Notes |
|---|---|---|---|
| `print_student_names` | `INTEGER NOT NULL` | `0` | One sheet per enrolled student, name pre-printed |
| `include_signature` | `INTEGER NOT NULL` | `0` | Signature line in the sheet header |
| `include_professor` | `INTEGER NOT NULL` | `0` | |
| `professor_name` | `TEXT NOT NULL` | `''` | Kept when the flag is off, so toggling back doesn't lose it |
| `include_declaration` | `INTEGER NOT NULL` | `0` | |
| `declaration_text` | `TEXT NOT NULL` | `''` | Same keep-on-toggle-off reasoning |

## Why this exists: a migration was edited after it had been applied

This is the interesting part, and the reason to read this file.

`0145_create_classroom_exams.sql` was applied to the live database on **2026-10-13 at
16:12**, creating `cls_exams` with ten columns. The `.sql` file was then **edited** to
add these six, and a second deploy went out at **22:15**.

That second deploy shipped code which queries the new columns — `listExams` selects
`e.print_student_names` — but it did not create them. `scripts/migrate.ts` filters
pending migrations against `sys_schema_migrations` and skips anything already recorded,
so the run printed `No pending migrations` and moved on. The file on the NAS was the
*new* text; the table on disk was the *old* shape.

Every render of `/modules/classroom/exam` then failed:

```
⨯ SqliteError: no such column: e.print_student_names
    at Object.listExams (.next/server/chunks/ssr/_1zkwo44._.js:87:328)
  code: 'SQLITE_ERROR', digest: '4129962423'
```

**An applied migration is history.** Editing it changes nothing on any database that
already ran it, and the only way to move a live schema forward is a new file. That is
exactly what the "never edit an applied migration" rule in `coding-guide.md` is about,
and this is what it looks like when it is broken: the repo and the live schema disagree
silently, and the failure surfaces as a runtime error in a route, not as a migration
error at deploy time.

## 0145 was reverted to match what it actually created

Rather than leave the six columns defined in two places, `0145`'s `CREATE TABLE` was
put back to the ten columns it really made, with a note not to re-add them. This file
is now the single definition.

That is what makes both paths agree, with no conditional SQL:

```
fresh database:  0145 (10 columns) -> 0146 (+6) = 16 columns
live database:   0145 already ran  -> 0146 (+6) = 16 columns
```

Conditional SQL was not an option anyway. SQLite has no
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, and `scripts/migrate.ts` runs each file
through a bare `db.exec()` inside one transaction — a duplicate-column error would
abort the entire run, taking every later migration with it.

Editing an applied migration is normally forbidden. The narrow justification here is
that the edit makes the file *honest about what it did*, and the removed text had
never been applied to any database in existence.

## Additive only, because the table has data

`cls_exams` held 1 exam and `cls_exam_questions` 30 key rows when this was written, so
dropping and recreating the table was never on the table.

`ALTER TABLE ADD COLUMN` with a `NOT NULL DEFAULT` backfills every existing row with
that default, which is the right reading for an exam created before these options
existed: no names printed, no signature line, no professor, no declaration. The
existing exam keeps its questions and its key, and simply gains the defaults.

Booleans are `INTEGER` 0/1, matching the `att_`/`cls_` convention (`is_reimbursed` in
0128 is the same shape). The two text columns are blank-never-NULL, per the project
convention, so no caller tests for both.

## Reversal

SQLite supports `ALTER TABLE ... DROP COLUMN` in the version bundled with
`better-sqlite3` here, so each column can be dropped individually. There is no reason
to: the columns are additive and default to the pre-0146 behaviour, so leaving them in
place on a rollback costs nothing and an older build simply never reads them.
