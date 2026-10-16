# 0145 — Classroom exams and answer keys

Creates `cls_exams` and `cls_exam_questions`: the Exam group's first tables, under
Classroom's existing `cls_` prefix.

Exam is the second **section group** inside Classroom (migration 0143 created that
shape, with Attendance as the first). It lives there rather than in a module of its
own because an exam is graded against the roster and classes attendance is already
taken for — `cls_students`, `cls_classes`, `cls_class_enrollments`. As a sibling
module it would have had to reach across a module boundary for its most basic input.

Full design in `plan_exam.md`.

## Why only two tables

Grading needs two more — one row per submitted sheet, one per question per
submission. They are **not** created here. Nothing writes them until there is a
photograph to read, and their columns (confidence, whether a mark was hand-corrected,
where the image lives) depend on decisions the Scan & Grade screen has not forced
yet. Creating them empty now would be schema whose shape nobody can defend, and
`coding-guide.md` makes a migration immutable once applied, so a guess would be
permanent.

These two are enough to build the Exam Home screen, the Exam Maker, and Print Sheets
— a working test *builder*, independently useful and independent of whether the
optical grading ever works.

## `exam_identifier` is not the primary key

`cls_exams` carries both an `id` and an `exam_identifier`:

| Column | Purpose |
|---|---|
| `id` | Surrogate integer PK. What `cls_exam_questions.exam_id` references and what the `?edit=` URL carries. Never shown to a reader. |
| `exam_identifier` | The **teacher's own** exam ID — "Quiz 1", "MIDTERM-A". Shown on screen and **printed on the answer sheet**, so a scanned page can be matched back to its exam. |

Keeping them apart is what makes the teacher's ID freely editable: retyping it can
never orphan the questions attached to that exam. `cls_students.student_identifier`
("School-assigned ID") is the same decision already made once in this module, and
migration 0108's log records the general trap — a slug or identifier that is also a
key is a rename waiting to orphan something.

### Why uniqueness is not an index

`exam_identifier` is validated for uniqueness **in the library**, per class and
case-insensitively, not by a `UNIQUE` index. Two reasons:

1. Two classes may legitimately both sit a "Quiz 1", so any index would have to be
   `(class_id, exam_identifier)` rather than the identifier alone.
2. The column defaults to `''` — an exam can be named before it is numbered — and a
   unique index would then forbid a *second* unnumbered exam in the same class,
   which is a rule nobody asked for.

The library check also produces a message the form can show, which an index
violation does not.

## `choice_set` stores letters, not a count

`'ABCD'` rather than `4`. The printed sheet, the answer key and (later) the detector
all read the same string, so none of them can disagree about what question 7 offered,
and someone reading the raw table can see it. Validated in zod against the known sets
rather than by a `CHECK`: the message reaches the form, and adding `'ABCDEF'` later
needs no table rebuild, since SQLite cannot alter a `CHECK`. Same reasoning as
`hsh_hsa_expenses.type` in migration 0128.

## Scoring: one value per exam

`points_per_question` sits on `cls_exams`, and a score is `correct_count ×
points_per_question`. Wrong, blank and double-marked answers all score **zero**; a
double-mark is additionally *flagged* for the operator on the review screen rather
than silently accepted, because a zero a human never saw is the failure mode this
module most needs to avoid.

Per-question points, if ever wanted, arrive as a **nullable** column on
`cls_exam_questions` that falls back to the exam's value. That is additive: every row
written before it stays correct, and no rebuild is needed.

## The answer-sheet options live on the exam

Six columns — `print_student_names`, `include_signature`, `include_professor`,
`professor_name`, `include_declaration`, `declaration_text` — configure what the
printed blank sheet carries above its answer grid.

They sit on the exam rather than being chosen at print time because they are
properties of *this exam's paperwork*: the professor who set it and the declaration
students sign are the same on every reprint, and nobody should retype them to print a
second batch. The two text columns are kept when their flag is turned off, so
toggling it back on does not lose what was typed.

`print_student_names` is the one with a wider consequence: when set, the print run
emits one sheet **per enrolled student**, each with the name already on it, so the
count is the class's enrollment rather than a typed number. The roster it reads is
`cls_students`/`cls_class_enrollments` — this module's own tables, which is the whole
reason Exam lives inside Classroom.

Booleans are `INTEGER` 0/1 with a `0` default, matching `hsh_hsa_expenses.is_reimbursed`
(0128). The text columns are blank-never-`NULL`, per the project convention.

## A blank `correct_choice` is a real state

`cls_exam_questions.correct_choice` defaults to `''`, meaning "not keyed yet". A
teacher builds a 40-question key over more than one sitting, so a partially keyed
exam has to be saveable. Blank rather than `NULL`, per the project convention that
this kind of value is blank and never null.

The consequence is that *completeness is a library question, not a schema one*:
printing a blank answer sheet does not need a key at all, while grading needs a
complete one, and `lib/exam` enforces that difference. The Home screen shows key
completeness per exam so an unfinished one is visible without opening it.

## No foreign keys

`cls_exams.class_id` and `cls_exam_questions.exam_id` carry no FK constraint,
following the `jrn_`/`cls_` convention stated in
`0047_create_attendance_tables.sql`. The repository maintains the links and performs
the cascade: deleting an exam deletes its question rows in the same transaction (see
`SqliteExamRepository.deleteExam`), exactly as `deleteRecipe` clears
`hsh_recipe_tags`.

## Indexes

- `idx_cls_exams_class` — listing one class's exams is the Home screen's only query.
- `idx_cls_exam_questions_unique` on `(exam_id, question_number)` — the real identity
  of a key row, and what makes "upsert the answer for question 7" a single statement.
  **No date column appears in it**, which is the unique-index trap `coding-guide.md`
  records.
