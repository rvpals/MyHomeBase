import type Database from "better-sqlite3";
import type { ExamRepository } from "./ports";
import type { AnswerWriteData, ExamWriteData } from "./schema";
import { DEFAULT_CHOICE_SET, type ChoiceSet, type Exam, type ExamQuestion, type ExamSummary } from "./types";

interface ExamRow {
  id: number;
  exam_identifier: string;
  name: string;
  description: string;
  class_id: number;
  question_count: number;
  choice_set: string;
  points_per_question: number;
  print_student_names: number;
  include_signature: number;
  include_professor: number;
  professor_name: string;
  include_student_id: number;
  include_declaration: number;
  declaration_text: string;
  created_at: string;
  updated_at: string;
}

interface ExamSummaryRow extends ExamRow {
  class_name: string | null;
  keyed_count: number;
}

interface QuestionRow {
  id: number;
  exam_id: number;
  question_number: number;
  correct_choice: string;
  created_at: string;
  updated_at: string;
}

/**
 * A stored choice set to the domain union, falling back to the default rather than
 * throwing.
 *
 * The column is validated in zod on the way in, so a bad value means a hand-edited
 * row or a set this build no longer knows. A read of the exam list must not fail
 * because of one such row — the same reasoning `readModule` uses in
 * `lib/messages/repository.ts`.
 */
function readChoiceSet(value: string): ChoiceSet {
  return value === "ABCD" || value === "ABCDE" ? value : DEFAULT_CHOICE_SET;
}

function toExam(row: ExamRow): Exam {
  return {
    id: row.id,
    examIdentifier: row.exam_identifier,
    name: row.name,
    description: row.description,
    classId: row.class_id,
    questionCount: row.question_count,
    choiceSet: readChoiceSet(row.choice_set),
    pointsPerQuestion: row.points_per_question,
    // SQLite has no boolean: the columns are INTEGER 0/1.
    printStudentNames: row.print_student_names === 1,
    includeSignature: row.include_signature === 1,
    includeProfessor: row.include_professor === 1,
    professorName: row.professor_name,
    includeStudentId: row.include_student_id === 1,
    includeDeclaration: row.include_declaration === 1,
    declarationText: row.declaration_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toQuestion(row: QuestionRow): ExamQuestion {
  return {
    id: row.id,
    examId: row.exam_id,
    questionNumber: row.question_number,
    correctChoice: row.correct_choice,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const EXAM_COLUMNS = `id, exam_identifier, name, description, class_id,
                      question_count, choice_set, points_per_question,
                      print_student_names, include_signature, include_professor,
                      professor_name, include_student_id, include_declaration,
                      declaration_text, created_at, updated_at`;

/**
 * The write parameters, with booleans flattened to the 0/1 the columns hold.
 *
 * better-sqlite3 refuses a JS boolean as a bound parameter, so this conversion is
 * required rather than cosmetic — and doing it in one place keeps the INSERT and the
 * UPDATE from disagreeing.
 */
function toWriteParams(input: ExamWriteData) {
  return {
    ...input,
    printStudentNames: input.printStudentNames ? 1 : 0,
    includeSignature: input.includeSignature ? 1 : 0,
    includeProfessor: input.includeProfessor ? 1 : 0,
    includeStudentId: input.includeStudentId ? 1 : 0,
    includeDeclaration: input.includeDeclaration ? 1 : 0,
  };
}

export class SqliteExamRepository implements ExamRepository {
  constructor(private readonly db: Database.Database) {}

  listExams(classId?: number): ExamSummary[] {
    // `class_name` is a live join rather than a stored snapshot: this list is a
    // picker, so it should name the class as it is called now. `keyed_count` is
    // derived here so a listing never loads key rows — the Home screen compares it
    // against question_count to show completeness.
    //
    // LEFT JOIN, not JOIN: there are no foreign keys in this schema, so a deleted
    // class would otherwise make its exams vanish from the list rather than show
    // with no class name.
    const rows = this.db
      .prepare(
        `SELECT e.id, e.exam_identifier, e.name, e.description, e.class_id,
                e.question_count, e.choice_set, e.points_per_question,
                e.print_student_names, e.include_signature, e.include_professor,
                e.professor_name, e.include_student_id, e.include_declaration,
                e.declaration_text,
                e.created_at, e.updated_at,
                c.name AS class_name,
                (SELECT COUNT(*)
                   FROM cls_exam_questions q
                  WHERE q.exam_id = e.id
                    AND q.correct_choice <> '') AS keyed_count
           FROM cls_exams e
           LEFT JOIN cls_classes c ON c.id = e.class_id
          WHERE (@classId IS NULL OR e.class_id = @classId)
          ORDER BY e.created_at DESC, e.id DESC`,
      )
      .all({ classId: classId ?? null }) as ExamSummaryRow[];

    return rows.map((row) => ({
      ...toExam(row),
      className: row.class_name ?? "",
      keyedCount: row.keyed_count,
    }));
  }

  getExamById(id: number): Exam | undefined {
    const row = this.db
      .prepare(`SELECT ${EXAM_COLUMNS} FROM cls_exams WHERE id = ?`)
      .get(id) as ExamRow | undefined;
    return row ? toExam(row) : undefined;
  }

  getExamByIdentifier(classId: number, examIdentifier: string): Exam | undefined {
    // Scoped to the class, and a blank never matches: "not numbered yet" is not a
    // collision, so two unnumbered exams in one class are legitimate. The
    // comparison is case-insensitive, which is why this is not a unique index.
    if (examIdentifier.trim() === "") return undefined;

    const row = this.db
      .prepare(
        `SELECT ${EXAM_COLUMNS}
           FROM cls_exams
          WHERE class_id = ?
            AND exam_identifier <> ''
            AND LOWER(exam_identifier) = LOWER(?)`,
      )
      .get(classId, examIdentifier.trim()) as ExamRow | undefined;
    return row ? toExam(row) : undefined;
  }

  createExam(input: ExamWriteData): Exam {
    const result = this.db
      .prepare(
        `INSERT INTO cls_exams (exam_identifier, name, description, class_id,
                                question_count, choice_set, points_per_question,
                                print_student_names, include_signature,
                                include_professor, professor_name,
                                include_student_id, include_declaration,
                                declaration_text)
         VALUES (@examIdentifier, @name, @description, @classId,
                 @questionCount, @choiceSet, @pointsPerQuestion,
                 @printStudentNames, @includeSignature,
                 @includeProfessor, @professorName,
                 @includeStudentId, @includeDeclaration, @declarationText)`,
      )
      .run(toWriteParams(input));

    const created = this.getExamById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back newly created exam.");
    return created;
  }

  updateExam(id: number, input: ExamWriteData): Exam {
    this.db
      .prepare(
        `UPDATE cls_exams
            SET exam_identifier = @examIdentifier,
                name = @name,
                description = @description,
                class_id = @classId,
                question_count = @questionCount,
                choice_set = @choiceSet,
                points_per_question = @pointsPerQuestion,
                print_student_names = @printStudentNames,
                include_signature = @includeSignature,
                include_professor = @includeProfessor,
                professor_name = @professorName,
                include_student_id = @includeStudentId,
                include_declaration = @includeDeclaration,
                declaration_text = @declarationText
          WHERE id = @id`,
      )
      .run({ ...toWriteParams(input), id });

    const updated = this.getExamById(id);
    if (!updated) throw new Error(`Failed to read back exam ${id} after update.`);
    return updated;
  }

  deleteExam(id: number): void {
    // No DB-level foreign keys in this schema (the jrn_/cls_ convention), so the
    // cascade is the repository's job — exactly as `deleteRecipe` clears
    // hsh_recipe_tags.
    const remove = this.db.transaction((examId: number) => {
      this.db.prepare(`DELETE FROM cls_exam_questions WHERE exam_id = ?`).run(examId);
      this.db.prepare(`DELETE FROM cls_exams WHERE id = ?`).run(examId);
    });
    remove(id);
  }

  deleteExams(ids: number[]): number {
    if (ids.length === 0) return 0;

    const removeMany = this.db.transaction((examIds: number[]) => {
      const deleteQuestions = this.db.prepare(
        `DELETE FROM cls_exam_questions WHERE exam_id = ?`,
      );
      const deleteExam = this.db.prepare(`DELETE FROM cls_exams WHERE id = ?`);
      let removed = 0;
      for (const examId of examIds) {
        deleteQuestions.run(examId);
        // `changes` rather than a prior existence check: an id that is already gone
        // is simply not counted, which is what the port promises.
        removed += deleteExam.run(examId).changes;
      }
      return removed;
    });

    return removeMany(ids);
  }

  listQuestions(examId: number): ExamQuestion[] {
    const rows = this.db
      .prepare(
        `SELECT id, exam_id, question_number, correct_choice, created_at, updated_at
           FROM cls_exam_questions
          WHERE exam_id = ?
          ORDER BY question_number`,
      )
      .all(examId) as QuestionRow[];
    return rows.map(toQuestion);
  }

  saveAnswers(examId: number, answers: AnswerWriteData[]): void {
    if (answers.length === 0) return;

    // An upsert on (exam_id, question_number) — the unique index exists for exactly
    // this. Questions not mentioned are untouched, so saving question 7 does not
    // clear the rest of the key.
    //
    // `updated_at` is set explicitly in the DO UPDATE branch: the table's trigger
    // fires on UPDATE, but an upsert that resolves to the conflict branch is not
    // guaranteed to be seen as one by it, so this is the dependable path.
    const save = this.db.transaction((rows: AnswerWriteData[]) => {
      const statement = this.db.prepare(
        `INSERT INTO cls_exam_questions (exam_id, question_number, correct_choice)
         VALUES (@examId, @questionNumber, @correctChoice)
         ON CONFLICT (exam_id, question_number)
         DO UPDATE SET correct_choice = @correctChoice,
                       updated_at = datetime('now')`,
      );
      for (const row of rows) {
        statement.run({
          examId,
          questionNumber: row.questionNumber,
          correctChoice: row.correctChoice,
        });
      }
    });

    save(answers);
  }

  deleteQuestionsAbove(examId: number, questionCount: number): number {
    return this.db
      .prepare(`DELETE FROM cls_exam_questions WHERE exam_id = ? AND question_number > ?`)
      .run(examId, questionCount).changes;
  }

  clearAnswersOutsideChoices(examId: number, allowedChoices: string[]): number {
    // The rows survive as unkeyed questions rather than being deleted: the question
    // still exists, it just has no valid answer any more.
    //
    // An empty allow-list would make `NOT IN ()` invalid SQL, so it is handled as
    // "clear every answer" — the only sensible reading, though no choice set is
    // actually empty.
    if (allowedChoices.length === 0) {
      return this.db
        .prepare(
          `UPDATE cls_exam_questions
              SET correct_choice = ''
            WHERE exam_id = ? AND correct_choice <> ''`,
        )
        .run(examId).changes;
    }

    const placeholders = allowedChoices.map(() => "?").join(", ");
    return this.db
      .prepare(
        `UPDATE cls_exam_questions
            SET correct_choice = ''
          WHERE exam_id = ?
            AND correct_choice <> ''
            AND correct_choice NOT IN (${placeholders})`,
      )
      .run(examId, ...allowedChoices).changes;
  }
}
