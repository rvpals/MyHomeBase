-- The Classroom module's Exam group: exams and their answer keys.
--
-- Same cls_ prefix as the attendance tables (0143) — the prefix is the module's
-- namespace, not an abbreviation of its first feature. An exam is graded against
-- cls_students and cls_classes, which is the whole reason Exam lives inside
-- Classroom rather than in a module of its own. See plan_exam.md.
--
-- Two tables now; the two that grading needs (submissions and their per-question
-- answers) land with the Scan & Grade screen, because nothing writes them until
-- there is a photograph to read. Creating them empty here would be schema nobody
-- can explain the shape of yet.
--
-- No DB-level foreign keys, following the jrn_/cls_ convention: cls_exams.class_id
-- and cls_exam_questions.exam_id are maintained by the repository, which also does
-- the cascade on delete (see SqliteExamRepository.deleteExam).

CREATE TABLE cls_exams (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The TEACHER's own exam ID ("Quiz 1", "MIDTERM-A"), shown on screen and printed
  -- on the answer sheet so a scanned page can be matched back to its exam.
  --
  -- Deliberately NOT the primary key, and deliberately editable: every question and
  -- submission references `id`, so retyping this can never orphan them. The same
  -- split cls_students already makes with student_identifier.
  --
  -- Blank is allowed — an exam can be named before it is numbered. Uniqueness is
  -- enforced in the library (per class, case-insensitively) rather than by an index:
  -- two classes may legitimately both sit "Quiz 1", and a UNIQUE(class_id,
  -- exam_identifier) index would also forbid a second blank in one class.
  exam_identifier      TEXT    NOT NULL DEFAULT '',
  name                 TEXT    NOT NULL,
  description          TEXT    NOT NULL DEFAULT '',
  -- The class this exam is for, from cls_classes. Not nullable: an exam exists to be
  -- graded against a roster, and "no class" would make every downstream screen carry
  -- a branch for a state the Exam Maker cannot produce.
  class_id             INTEGER NOT NULL,
  -- How many questions the sheet prints and the key holds. The key is a row per
  -- question in cls_exam_questions; this column is what the sheet layout and the
  -- Exam Maker's answer rows are built from, so the two cannot disagree.
  question_count       INTEGER NOT NULL,
  -- The choice set as the LETTERS themselves ('ABCD', 'ABCDE'), not a count.
  --
  -- Storing the letters rather than `4` means the printed sheet, the key and the
  -- detector all read the same string, and a reader of the raw table can see what a
  -- question offered. Validated in zod against the known sets rather than by a
  -- CHECK, so the message reaches the form and adding a set later needs no table
  -- rebuild (SQLite cannot alter a CHECK).
  choice_set           TEXT    NOT NULL DEFAULT 'ABCD',
  -- Points for one correct answer. One value for the whole exam: score is
  -- correct_count * this. Wrong, blank and double-marked answers all score zero.
  --
  -- Per-question points, if ever wanted, arrive as a NULLABLE column on
  -- cls_exam_questions that falls back to this one — an additive change that leaves
  -- every existing row correct.
  points_per_question  INTEGER NOT NULL DEFAULT 1,
  -- NOTE: the six answer-sheet option columns (print_student_names,
  -- include_signature, include_professor, professor_name, include_declaration,
  -- declaration_text) are NOT defined here. They were briefly added to this file
  -- after it had already been applied, which created them on no database at all --
  -- an applied migration never re-runs. They now live in 0146, which is the single
  -- place they are defined, so a fresh database and the live one end up identical.
  -- Do not add them back here.
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Listing exams for one class is the Home screen's only query.
CREATE INDEX idx_cls_exams_class ON cls_exams (class_id);

-- Same updated_at trigger the cls_ tables already use (0047), rather than having
-- every caller remember to set it.
CREATE TRIGGER cls_exams_set_updated_at
AFTER UPDATE ON cls_exams
FOR EACH ROW
BEGIN
  UPDATE cls_exams SET updated_at = datetime('now') WHERE id = old.id;
END;

-- The answer key: one row per question per exam.
--
-- There is no separate "key" table because a key IS exactly one correct choice per
-- question. A question whose correct_choice is blank is an UNANSWERED key row, which
-- is a legitimate saved state — a teacher builds a 40-question key over more than
-- one sitting, so the schema must not require a complete key. Printing a blank sheet
-- does not need one; grading does, and the library enforces that rather than the
-- table.
CREATE TABLE cls_exam_questions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id         INTEGER NOT NULL,
  -- 1-based, matching the number printed on the sheet, so a reader of the raw table
  -- sees question 1 as 1.
  question_number INTEGER NOT NULL,
  -- One letter from the exam's choice_set, or '' for "not keyed yet".
  --
  -- Blank rather than NULL, per the project convention that a settings-like value is
  -- blank and never NULL. Validated against the parent exam's choice_set in the
  -- library, which is also where narrowing a choice set invalidates an orphaned 'E'.
  correct_choice  TEXT    NOT NULL DEFAULT '',
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- One row per question per exam. Deliberately NOT a date column in sight: this is
-- the unique index coding-guide.md warns about getting wrong, and (exam_id,
-- question_number) is the real identity of a key row.
CREATE UNIQUE INDEX idx_cls_exam_questions_unique
  ON cls_exam_questions (exam_id, question_number);

CREATE TRIGGER cls_exam_questions_set_updated_at
AFTER UPDATE ON cls_exam_questions
FOR EACH ROW
BEGIN
  UPDATE cls_exam_questions SET updated_at = datetime('now') WHERE id = old.id;
END;
