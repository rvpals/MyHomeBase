import { z } from "zod";
import {
  CHOICE_SETS,
  DEFAULT_CHOICE_SET,
  DEFAULT_PROFESSOR_NAME,
  choiceLetters,
  type ChoiceSet,
} from "./types";

/**
 * How many questions one exam may hold.
 *
 * The upper bound is a sanity limit, not a layout one: the sheet paginates, but a
 * typo of `2000` in the Exam Maker would otherwise render two thousand answer rows
 * and appear to hang. 200 is far past any real classroom test.
 */
export const MIN_QUESTION_COUNT = 1;
export const MAX_QUESTION_COUNT = 200;

/** Points per correct answer. Zero is allowed — an ungraded practice sheet. */
export const MAX_POINTS_PER_QUESTION = 1000;

/**
 * How long a declaration may be.
 *
 * A cap rather than free length because the sheet must fit one page: the declaration
 * is the only block on it whose height the teacher controls, so an unbounded paste
 * would push the answer grid onto a second page — exactly what the layout exists to
 * prevent.
 */
export const MAX_DECLARATION_LENGTH = 600;

const choiceSetSchema = z.enum(CHOICE_SETS);

/**
 * The fields the Exam Maker's "New Exam" card writes.
 *
 * The optional text fields default to `""` so the repository always has a value to
 * write — the columns are `NOT NULL` with a blank default, matching the `cls_`/`exp_`
 * convention that a missing value is blank rather than `NULL`.
 */
export const examWriteSchema = z.object({
  // Blank is allowed: an exam can be named before it is numbered. Uniqueness is
  // checked in the use-case (per class, case-insensitively) rather than here,
  // because a schema cannot see the other exams.
  examIdentifier: z.string().trim().default(""),
  name: z.string().trim().min(1, "Exam name is required."),
  description: z.string().trim().default(""),
  classId: z.number().int().positive("Pick the class this exam is for."),
  questionCount: z
    .number()
    .int()
    .min(MIN_QUESTION_COUNT, `An exam needs at least ${MIN_QUESTION_COUNT} question.`)
    .max(MAX_QUESTION_COUNT, `An exam cannot have more than ${MAX_QUESTION_COUNT} questions.`),
  choiceSet: choiceSetSchema.default(DEFAULT_CHOICE_SET),
  pointsPerQuestion: z
    .number()
    .int()
    .min(0, "Points cannot be negative.")
    .max(MAX_POINTS_PER_QUESTION, `Points cannot exceed ${MAX_POINTS_PER_QUESTION}.`)
    .default(1),

  // Answer-sheet options. All default to "off" so an exam created by the CLI, or by
  // an older caller that doesn't know about them, gets the plain sheet.
  printStudentNames: z.boolean().default(false),
  includeSignature: z.boolean().default(false),
  includeProfessor: z.boolean().default(false),
  // Not required even when includeProfessor is set: the form seeds it with
  // DEFAULT_PROFESSOR_NAME, and an empty one simply prints an empty line rather than
  // blocking a save someone will finish later.
  professorName: z.string().trim().default(DEFAULT_PROFESSOR_NAME),
  includeStudentId: z.boolean().default(false),
  includeDeclaration: z.boolean().default(false),
  // Capped so a pasted essay cannot push the answer grid off the page — the sheet
  // has to fit one page, and the declaration is the only free-length block on it.
  declarationText: z.string().trim().max(MAX_DECLARATION_LENGTH).default(""),
});

export type ExamWriteData = z.infer<typeof examWriteSchema>;

export const createExamSchema = examWriteSchema;
export type CreateExamInput = z.infer<typeof createExamSchema>;

export const updateExamSchema = examWriteSchema.extend({
  id: z.number().int().positive(),
});
export type UpdateExamInput = z.infer<typeof updateExamSchema>;

export const examIdSchema = z.object({
  id: z.number().int().positive(),
});

export const examIdsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1, "Select at least one exam."),
});

/**
 * One answer being set, from the "New Answer" card.
 *
 * `correctChoice` accepts a blank, which **clears** that question's answer rather
 * than failing — a teacher must be able to un-answer a question they keyed by
 * mistake. A single letter is upper-cased first so typing `b` works; whether the
 * letter is actually in the exam's choice set is checked in the use-case, which can
 * see the exam.
 */
export const answerSchema = z.object({
  questionNumber: z.number().int().min(1),
  correctChoice: z
    .string()
    .trim()
    .toUpperCase()
    .max(1, "An answer is a single letter.")
    .default(""),
});

export type AnswerInput = z.infer<typeof answerSchema>;

/** Setting one question's answer. */
export const setAnswerSchema = answerSchema.extend({
  examId: z.number().int().positive(),
});
export type SetAnswerInput = z.infer<typeof setAnswerSchema>;

/**
 * Saving the whole key at once — what the New Answer card's Save does.
 *
 * The array may be partial and may contain blanks: both mean "this is the state of
 * the key now", not "every question is answered". Duplicate question numbers are
 * rejected here rather than silently last-wins, because two inputs claiming the same
 * question is a bug in the caller, not a user error.
 */
export const saveAnswerKeySchema = z.object({
  examId: z.number().int().positive(),
  answers: z
    .array(answerSchema)
    .refine(
      (answers) =>
        new Set(answers.map((answer) => answer.questionNumber)).size === answers.length,
      "The same question appears twice.",
    ),
});

export type SaveAnswerKeyInput = z.infer<typeof saveAnswerKeySchema>;

/** What the repository writes for one key row. */
export interface AnswerWriteData {
  questionNumber: number;
  correctChoice: string;
}

/**
 * Whether `choice` is a letter the given choice set offers.
 *
 * Blank passes: it is the "not keyed yet" value, not a wrong answer. Lives here
 * rather than in `types.ts` because it is a validation rule, and the use-cases call
 * it with an exam's own `choiceSet` — which a zod schema cannot reach.
 */
export function isValidChoice(choice: string, choiceSet: ChoiceSet): boolean {
  if (choice === "") return true;
  return choiceLetters(choiceSet).includes(choice);
}
