import { detectMarks } from "./detect-marks";
import { gradeSheet, matchStudentByFileName, type GradedSheet, type MatchableStudent } from "./grading";
import type { ExamRepository, SheetImageProcessor } from "./ports";
import {
  isValidChoice,
  type AnswerWriteData,
  type CreateExamInput,
  type SaveAnswerKeyInput,
  type UpdateExamInput,
} from "./schema";
import {
  UNKEYED_CHOICE,
  choiceLetters,
  type Exam,
  type ExamQuestion,
  type ExamSummary,
  type ExamWithKey,
  type KeyCompleteness,
} from "./types";

/** Thrown for a rule the schema cannot check, because it needs the stored data. */
export class ExamValidationError extends Error {}

export function listExams(repo: ExamRepository, classId?: number): ExamSummary[] {
  return repo.listExams(classId);
}

export function getExamById(repo: ExamRepository, id: number): Exam | undefined {
  return repo.getExamById(id);
}

function requireExam(repo: ExamRepository, id: number): Exam {
  const exam = repo.getExamById(id);
  if (!exam) throw new ExamValidationError(`No exam with id ${id}.`);
  return exam;
}

/**
 * Rejects an exam identifier already used by another exam in the same class.
 *
 * Case-insensitive, and blank is always allowed — "not numbered yet" is not a
 * collision, so two unnumbered exams in one class are fine. `excludeExamId` lets an
 * update keep its own identifier without colliding with itself.
 *
 * Here rather than in the schema because it needs to see the other exams, and here
 * rather than as a unique index because the message has to reach the form and
 * because a blank default would make an index forbid a second unnumbered exam.
 */
function requireUniqueIdentifier(
  repo: ExamRepository,
  classId: number,
  examIdentifier: string,
  excludeExamId?: number,
): void {
  if (examIdentifier === "") return;
  const existing = repo.getExamByIdentifier(classId, examIdentifier);
  if (existing && existing.id !== excludeExamId) {
    throw new ExamValidationError(
      `This class already has an exam with ID "${existing.examIdentifier}".`,
    );
  }
}

export function createExam(repo: ExamRepository, input: CreateExamInput): Exam {
  requireUniqueIdentifier(repo, input.classId, input.examIdentifier);
  return repo.createExam(input);
}

/** What `updateExam` had to throw away to honour the new shape. */
export interface ExamUpdateResult {
  exam: Exam;
  /**
   * Answers discarded because the exam now has fewer questions.
   *
   * Reported rather than silent: shrinking a 40-question exam to 20 destroys twenty
   * recorded answers, and a caller that cannot say so has no way to warn anyone.
   */
  discardedAnswers: number;
  /**
   * Answers cleared because they are no longer offered — an `E` after the choice set
   * narrowed to `ABCD`. The questions survive as unkeyed.
   */
  invalidatedAnswers: number;
}

/**
 * Updates an exam and reconciles its key with the new shape.
 *
 * Two edits reach backwards into answers that already exist, and both are handled
 * here rather than being left for the view to notice:
 *
 * - **Fewer questions** — key rows above the new count are deleted.
 * - **A narrower choice set** (`ABCDE` -> `ABCD`) — answers naming a letter the exam
 *   no longer offers are cleared, leaving the question unkeyed.
 *
 * Growing the exam or widening the choice set needs no reconciliation: the extra
 * questions are simply unkeyed, which is already a legitimate state.
 *
 * The counts come back so the caller can warn *after* the fact. Warning *before* it
 * would need a separate "what would this cost me" call, which is worth adding only
 * if the UI asks for a confirmation step.
 */
export function updateExam(repo: ExamRepository, input: UpdateExamInput): ExamUpdateResult {
  const existing = requireExam(repo, input.id);
  requireUniqueIdentifier(repo, input.classId, input.examIdentifier, input.id);

  const exam = repo.updateExam(input.id, input);

  const discardedAnswers =
    input.questionCount < existing.questionCount
      ? repo.deleteQuestionsAbove(input.id, input.questionCount)
      : 0;

  const invalidatedAnswers =
    input.choiceSet === existing.choiceSet
      ? 0
      : repo.clearAnswersOutsideChoices(input.id, choiceLetters(input.choiceSet));

  return { exam, discardedAnswers, invalidatedAnswers };
}

export function deleteExam(repo: ExamRepository, id: number): void {
  requireExam(repo, id);
  repo.deleteExam(id);
}

export function deleteExams(repo: ExamRepository, ids: number[]): number {
  return repo.deleteExams(ids);
}

/**
 * An exam with its key, padded to one entry per question.
 *
 * The stored rows are sparse — a question nobody has keyed has no row at all — but
 * the Exam Maker renders an input per question, so a caller would otherwise have to
 * invent the gaps itself. Padding here means every view and the CLI see the same
 * complete list, in question order.
 *
 * The synthetic rows carry `id: 0`, which no stored row can have: they do not exist
 * yet, and treating one as saved would be wrong.
 */
export function getExamWithKey(repo: ExamRepository, examId: number): ExamWithKey {
  const exam = requireExam(repo, examId);
  const stored = new Map(
    repo.listQuestions(examId).map((question) => [question.questionNumber, question]),
  );

  const questions: ExamQuestion[] = [];
  for (let number = 1; number <= exam.questionCount; number += 1) {
    const row = stored.get(number);
    questions.push(
      row ?? {
        id: 0,
        examId,
        questionNumber: number,
        correctChoice: UNKEYED_CHOICE,
        createdAt: "",
        updatedAt: "",
      },
    );
  }

  return { exam, questions };
}

/**
 * Saves part or all of an answer key.
 *
 * Every answer is validated against the exam's own choice set and question count,
 * which the schema cannot see. A blank clears that question rather than failing — a
 * teacher must be able to un-answer a question keyed by mistake.
 */
export function saveAnswerKey(repo: ExamRepository, input: SaveAnswerKeyInput): ExamWithKey {
  const exam = requireExam(repo, input.examId);
  const allowed = choiceLetters(exam.choiceSet);

  const writes: AnswerWriteData[] = [];
  for (const answer of input.answers) {
    if (answer.questionNumber > exam.questionCount) {
      throw new ExamValidationError(
        `This exam has ${exam.questionCount} questions, so there is no question ${answer.questionNumber}.`,
      );
    }
    if (!isValidChoice(answer.correctChoice, exam.choiceSet)) {
      throw new ExamValidationError(
        `"${answer.correctChoice}" is not one of this exam's choices (${allowed.join(", ")}).`,
      );
    }
    writes.push({
      questionNumber: answer.questionNumber,
      correctChoice: answer.correctChoice,
    });
  }

  if (writes.length > 0) repo.saveAnswers(input.examId, writes);
  return getExamWithKey(repo, input.examId);
}

/**
 * Whether an exam can be graded, and what is missing if not.
 *
 * Grading needs every question keyed; **printing does not**, which is why this is a
 * question the library answers rather than a constraint the table enforces. The
 * Home screen shows the counts so an unfinished key is visible without opening it.
 */
export function keyCompleteness(repo: ExamRepository, examId: number): KeyCompleteness {
  const { exam, questions } = getExamWithKey(repo, examId);
  const missing = questions
    .filter((question) => question.correctChoice === UNKEYED_CHOICE)
    .map((question) => question.questionNumber);

  return {
    questionCount: exam.questionCount,
    keyedCount: exam.questionCount - missing.length,
    isComplete: missing.length === 0,
    missingQuestionNumbers: missing,
  };
}

/**
 * What happened when the sheet was searched for a student-ID QR code.
 *
 * Deliberately separate from `identifiedBy`, because the two answer different
 * questions and can disagree: a code can decode perfectly and still leave the student
 * unidentified, when the id it carries is not on this class roster. Collapsing them
 * would report that as "no QR", sending the operator to look at the printer when the
 * problem is the roster.
 *
 * The distinction between `not-found` and `unreadable` is the one that matters for
 * diagnosis: the first means the crop landed on blank paper (wrong position, or the
 * sheet genuinely has no code), the second means ink was there and would not resolve
 * (too small, too blurred, too faint, damaged).
 */
export type QrStatus =
  /** This exam does not print a code, so none was looked for. */
  | "not-printed"
  /** A code was found and decoded, and the id was on the roster. */
  | "decoded"
  /** Decoded, but the id it carries is not a student in this class. */
  | "unknown-student"
  /** Searched where the code should be and found nothing resembling one. */
  | "not-found"
  /** Something was there but would not decode. */
  | "unreadable";

/** One scan, graded. */
export interface GradedScan {
  /** The uploaded file's name, which is also how the student is identified. */
  fileName: string;
  studentId?: number;
  studentName?: string;
  /** True when the file name matched nobody, or matched two students equally. */
  needsStudent: boolean;
  /** False when the anchor bars were not found — treat the read with suspicion. */
  anchorsFound: boolean;
  /**
   * How the sheet was attributed to a student.
   *
   * `qr` is the printed code, which was generated from the roster and is error
   * corrected. `file-name` is a fuzzy match on whatever the scanner named the file.
   * The screen shows the difference because they do not deserve equal trust.
   */
  identifiedBy: "qr" | "file-name" | "none";
  /**
   * What the QR search found, for the result screen to report.
   *
   * Set by the caller, which is the layer that actually ran the decode -- this
   * use-case only sees the id that came out of it.
   */
  qrStatus: QrStatus;
  /** The id the code carried, even when it matched nobody. Lets the screen show it. */
  scannedIdentifier?: string;
  sheet: GradedSheet;
}

/**
 * Grades one scanned sheet.
 *
 * Takes the decoded bitmap rather than the file bytes: decoding is the one part that
 * needs `sharp`, so it stays behind the `SheetImageProcessor` port and the caller does
 * it. That keeps this function testable with a synthetic bitmap.
 *
 * `gridTop` must be the header height the sheet was PRINTED with — the same value the
 * renderer passed to `buildSheetLayout`. Pass a different one and every bubble is
 * sampled in the wrong place, which reads as a sheet full of blanks rather than as an
 * error, so the caller computes it from the exam's own options.
 */
export function gradeScan(
  repo: ExamRepository,
  examId: number,
  fileName: string,
  bitmap: Parameters<typeof detectMarks>[0],
  gridTop: number,
  roster: MatchableStudent[],
  /**
   * The student id read off the QR on the sheet, when there was one.
   *
   * Decoded by the caller rather than here: reading a QR is asynchronous and this
   * use-case is not, and the decode belongs beside the image decode that already
   * happens one layer up.
   *
   * Takes precedence over the file name when it matches a roster entry. A file name
   * is whatever the scanner chose to call the file, often a counter, while the QR was
   * printed from the roster itself and is error-corrected -- it either reads correctly
   * or not at all.
   */
  scannedIdentifier?: string,
  /**
   * What the caller’s decode attempt produced, before any roster check.
   *
   * Passed in rather than inferred from `scannedIdentifier`, because "no id" has
   * several causes the caller can tell apart and this function cannot: a sheet with
   * no code printed, a crop that found blank paper, and ink that would not resolve.
   * This function upgrades it to `unknown-student` when a decoded id matches nobody.
   */
  qrStatus: QrStatus = "not-printed",
): GradedScan {
  const exam = requireExam(repo, examId);
  const key = repo.listQuestions(examId);

  const detection = detectMarks(bitmap, exam.questionCount, exam.choiceSet, gridTop);
  const sheet = gradeSheet(detection.answers, key, exam.pointsPerQuestion);
  // The QR first, the file name only as a fallback.
  const fromQr =
    // An empty id matches nobody, deliberately. A roster often has students with no
    // identifier recorded, and `"" === ""` would attribute a sheet to whichever of
    // them happened to come first.
    scannedIdentifier === undefined || scannedIdentifier === ""
      ? undefined
      : roster.find((student) => student.studentIdentifier === scannedIdentifier);
  const match = fromQr
    ? { studentId: fromQr.id, studentName: fromQr.name, score: 1 }
    : matchStudentByFileName(fileName, roster);

  return {
    fileName,
    studentId: match.studentId,
    studentName: match.studentName,
    // No confident match: the screen leaves the row for a human rather than guessing,
    // which is the one thing a grade must never be.
    needsStudent: match.studentId === undefined,
    anchorsFound: detection.anchorsFound,
    // How this sheet was attributed, so the screen can say so rather than leaving the
    // operator to guess whether a name came from a printed code or from a file name.
    // A decoded id that matches nobody is its own diagnosis, and only this function
    // can make it -- the caller has no roster. Without this the screen would report
    // a perfectly readable code as if the scan had failed.
    qrStatus:
      qrStatus === "decoded" && !fromQr ? "unknown-student" : qrStatus,
    scannedIdentifier,
    identifiedBy: fromQr
      ? ("qr" as const)
      : match.studentId === undefined
        ? ("none" as const)
        : ("file-name" as const),
    sheet,
  };
}

/** Re-exported so a caller can decode without reaching past the front door. */
export type { SheetImageProcessor };
