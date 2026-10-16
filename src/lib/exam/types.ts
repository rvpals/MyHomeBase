/**
 * The choice sets an exam can offer.
 *
 * The LETTERS themselves rather than a count, so the printed sheet, the answer key
 * and (later) the mark detector all read one string and cannot disagree about what
 * question 7 offered. Stored in `cls_exams.choice_set`.
 *
 * Adding a set here is the whole change — the column is validated in zod rather than
 * by a SQL `CHECK`, precisely so a new set needs no table rebuild.
 */
export const CHOICE_SETS = ["ABCD", "ABCDE"] as const;

export type ChoiceSet = (typeof CHOICE_SETS)[number];

/** The default for a new exam: four choices is the common case. */
export const DEFAULT_CHOICE_SET: ChoiceSet = "ABCD";

/**
 * What the professor field starts as on a new exam.
 *
 * A default rather than a hardcoded value: the field is editable, and the column
 * holds whatever was typed. Here rather than in the form so the CLI and any future
 * caller start from the same place.
 */
export const DEFAULT_PROFESSOR_NAME = "Dr Ting Sun";

/**
 * What the declaration field starts as when the option is first switched on.
 *
 * A real default rather than a placeholder: a placeholder only *looks* filled in, and
 * an exam saved without touching the box would print an empty declaration block —
 * worse than no block at all, since the border still prints.
 *
 * Seeded only when the text is empty, so switching the option off and on again never
 * overwrites wording someone has edited.
 *
 * Wording is the institution's business, not this app's, which is why it is editable
 * and capped rather than fixed. This is a sensible opening sentence, not a legal
 * position.
 */
export const DEFAULT_DECLARATION_TEXT =
  "I agree not to distribute, reproduce or share this exam in any form.";

/**
 * The stored value meaning "this question has no correct answer yet".
 *
 * Blank rather than `NULL`, per the project convention. A partially keyed exam is a
 * legitimate saved state: a 40-question key gets built over more than one sitting,
 * so the schema must not demand a complete one. Printing a blank sheet needs no key;
 * grading needs a complete one, and that difference is enforced here rather than by
 * the table.
 */
export const UNKEYED_CHOICE = "";

/** The letters of one choice set, as an array. `"ABCD"` -> `["A","B","C","D"]`. */
export function choiceLetters(choiceSet: ChoiceSet): string[] {
  return choiceSet.split("");
}

/**
 * One question's correct answer.
 *
 * `questionNumber` is 1-based, matching the number printed on the sheet, so a reader
 * of the raw table sees question 1 as 1.
 */
export interface ExamQuestion {
  id: number;
  examId: number;
  questionNumber: number;
  /** One letter from the exam's choice set, or `UNKEYED_CHOICE` when not yet keyed. */
  correctChoice: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * An exam, without its answer key.
 *
 * The list projection *and* the record — `examIdentifier` through
 * `pointsPerQuestion` is everything the Exam Maker edits, and the Home screen's grid
 * shows a subset. `ExamSummary` below adds the derived counts a list needs so that a
 * listing does not have to load every key row.
 */
export interface Exam {
  /**
   * The surrogate key. What `cls_exam_questions.exam_id` references and what the
   * `?edit=` URL carries. Never shown to a reader — `examIdentifier` is.
   */
  id: number;
  /**
   * The teacher's own exam ID — "Quiz 1", "MIDTERM-A". Shown on screen and printed
   * on the answer sheet so a scanned page can be matched back to its exam.
   *
   * Freely editable precisely because it is not the key: retyping it cannot orphan
   * the questions attached to this exam. Empty when not yet numbered.
   */
  examIdentifier: string;
  name: string;
  /** Empty when unrecorded. */
  description: string;
  /** The class this exam is for, from `cls_classes`. */
  classId: number;
  questionCount: number;
  choiceSet: ChoiceSet;
  /** Points for one correct answer. A score is `correctCount * this`. */
  pointsPerQuestion: number;
  /**
   * Print one sheet per enrolled student, each with the student's name on it.
   *
   * When false, blank name lines are printed and how many sheets to emit is typed at
   * print time. When true the count IS the class's enrollment, so the print dialog
   * stops asking for one.
   */
  printStudentNames: boolean;
  /** A signature line in the sheet header. */
  includeSignature: boolean;
  includeProfessor: boolean;
  /**
   * Printed when `includeProfessor`. Kept when the flag is off, so toggling it back
   * on does not lose what was typed. Empty when never set.
   */
  professorName: string;
  /**
   * Print a bubble grid encoding the student's ID, already shaded.
   *
   * Identifies a sheet only alongside `printStudentNames`, which is what makes the run
   * one sheet per student — the only point at which the app knows whose ID to shade.
   * With that off a blank grid prints, which is a legitimate but anonymous sheet.
   */
  includeStudentId: boolean;
  includeDeclaration: boolean;
  /**
   * Printed as a block just above the answer grid when `includeDeclaration`. Free
   * text — the wording is the institution's, not this app's. Same keep-on-toggle-off
   * reasoning as `professorName`.
   */
  declarationText: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * One exam as a list row: the record plus what a reader needs to tell two exams
 * apart without opening either.
 *
 * `className` and `keyedCount` are derived in SQL rather than stored. `className` is
 * a live join and not a snapshot — unlike `AttendanceEntry.studentName`, which is
 * deliberately frozen at save time. The difference is that an attendance report is a
 * historical document, while this is a picker: it should name the class as it is
 * called *now*, because that is how the reader will look for it.
 */
export interface ExamSummary extends Exam {
  /** The class's current name, or empty if the class row is gone. */
  className: string;
  /**
   * How many of this exam's questions have a correct answer recorded.
   *
   * Compared against `questionCount` to show key completeness, so an unfinished exam
   * is visible in the list without opening it. Can exceed nothing and fall short:
   * `keyedCount < questionCount` means a partial key, which is savable by design.
   */
  keyedCount: number;
}

/**
 * An exam together with its full answer key — what the Exam Maker loads to edit.
 *
 * `questions` always holds exactly `exam.questionCount` entries, in question-number
 * order, including unkeyed ones. The editor renders a row per question, so a missing
 * row would mean a missing input; `getExamWithKey` fills any gap rather than letting
 * the view compensate.
 */
export interface ExamWithKey {
  exam: Exam;
  questions: ExamQuestion[];
}

/** Whether an exam's key is complete enough to grade against. */
export interface KeyCompleteness {
  questionCount: number;
  keyedCount: number;
  /** True only when every question has a correct answer. */
  isComplete: boolean;
  /** The question numbers still unkeyed, ascending. Empty when complete. */
  missingQuestionNumbers: number[];
}
