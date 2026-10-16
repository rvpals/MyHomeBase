import type { AnswerWriteData, ExamWriteData } from "./schema";
import type { Exam, ExamQuestion, ExamSummary } from "./types";

// The use-cases depend on THIS interface, not on a concrete database.
// That is what lets the web app, the CLI, and tests each supply their own.
export interface ExamRepository {
  /**
   * Every exam, newest first, with its class name and keyed count.
   *
   * Optionally narrowed to one class — the Home screen's filter. The counts are
   * derived in SQL so a listing never loads key rows.
   */
  listExams(classId?: number): ExamSummary[];
  getExamById(id: number): Exam | undefined;
  /**
   * The exam whose `exam_identifier` matches, within one class, ignoring case.
   *
   * Scoped to a class because two classes may legitimately both sit a "Quiz 1". A
   * blank identifier never matches — it means "not numbered yet", so two unnumbered
   * exams in one class are not a collision.
   */
  getExamByIdentifier(classId: number, examIdentifier: string): Exam | undefined;
  createExam(input: ExamWriteData): Exam;
  updateExam(id: number, input: ExamWriteData): Exam;
  /** Also deletes the exam's question rows, in one transaction. */
  deleteExam(id: number): void;
  /**
   * Deletes several exams in one transaction, returning how many rows were actually
   * removed — an id that no longer exists is simply not counted. Clears their
   * question rows too, exactly as `deleteExam` does.
   */
  deleteExams(ids: number[]): number;

  /** One exam's key rows, ascending by question number. May be sparse. */
  listQuestions(examId: number): ExamQuestion[];
  /**
   * Writes the given answers, inserting or updating one row per question number.
   *
   * An upsert on `(exam_id, question_number)` — the unique index exists for this.
   * Answers not mentioned are left alone, so saving question 7 does not clear the
   * rest of the key.
   */
  saveAnswers(examId: number, answers: AnswerWriteData[]): void;
  /**
   * Removes key rows whose question number exceeds `questionCount`.
   *
   * Called when an exam shrinks. Separate from `saveAnswers` because it is a
   * consequence of editing the *exam*, not of editing the key, and the use-case has
   * to be able to report how many answers it discarded before doing it.
   */
  deleteQuestionsAbove(examId: number, questionCount: number): number;
  /**
   * Clears any answer that is not a letter in `allowedChoices`.
   *
   * Called when an exam's choice set narrows (`ABCDE` -> `ABCD`), which orphans every
   * answer of `E`. Returns how many were cleared. The rows survive as unkeyed
   * questions rather than being deleted — the question still exists, it just has no
   * valid answer any more.
   */
  clearAnswersOutsideChoices(examId: number, allowedChoices: string[]): number;
}

export type { SheetImageProcessor } from "./sheet-image-processor";
