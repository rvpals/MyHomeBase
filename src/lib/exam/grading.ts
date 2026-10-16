import type { DetectedAnswer } from "./detect-marks";
import type { ExamQuestion } from "./types";

/**
 * Scoring a read sheet against an answer key, and matching a scan to a student.
 *
 * Pure functions over plain data: no image, no database, no file system. The grader
 * screen and the CLI both drive these, and they are the part of grading that must be
 * exactly right, so they are tested directly rather than through the UI.
 */

/** One question's outcome on one sheet. */
export interface GradedAnswer {
  questionNumber: number;
  /** What the sheet was read as, or "" for blank/ambiguous. */
  detected: string;
  /** The key's answer, or "" when the question was never keyed. */
  correct: string;
  isCorrect: boolean;
  /** Carried through so the review table can flag a guess. */
  confidence: number;
  issue: DetectedAnswer["issue"];
  /** Per-choice darkness, for the review UI's bar. */
  darkness: number[];
}

/** One sheet's result. */
export interface GradedSheet {
  answers: GradedAnswer[];
  correctCount: number;
  /** `correctCount * pointsPerQuestion`. */
  score: number;
  /** `questionCount * pointsPerQuestion`. */
  maxScore: number;
  /** How many answers carry an issue — what the "needs attention" count shows. */
  flaggedCount: number;
}

/**
 * Scores one sheet.
 *
 * Wrong, blank and ambiguous all score **zero** — the rule settled when the schema was
 * written, and the reason there is no penalty arithmetic here. An **unkeyed** question
 * also scores zero and is never counted correct: a key the teacher has not finished is
 * not a reason to award a mark, and `keyCompleteness` is what should have stopped the
 * grading run before this point.
 */
export function gradeSheet(
  detected: DetectedAnswer[],
  key: ExamQuestion[],
  pointsPerQuestion: number,
): GradedSheet {
  const correctByQuestion = new Map(
    key.map((question) => [question.questionNumber, question.correctChoice]),
  );

  const answers: GradedAnswer[] = detected.map((answer) => {
    const correct = correctByQuestion.get(answer.questionNumber) ?? "";
    return {
      questionNumber: answer.questionNumber,
      detected: answer.choice,
      correct,
      // A blank key answer can never be matched, even by a blank sheet.
      isCorrect: correct !== "" && answer.choice === correct,
      confidence: answer.confidence,
      issue: answer.issue,
      darkness: answer.darkness,
    };
  });

  const correctCount = answers.filter((answer) => answer.isCorrect).length;

  return {
    answers,
    correctCount,
    score: correctCount * pointsPerQuestion,
    maxScore: answers.length * pointsPerQuestion,
    flaggedCount: answers.filter((answer) => answer.issue !== "none").length,
  };
}

/**
 * Normalises a file name into something comparable with a student's name.
 *
 * `"Chen, Alice_quiz1.JPG"` -> `"chen alice quiz1"`. Punctuation and separators become
 * spaces so the token matcher below sees words rather than a slug, and the extension
 * is dropped because nobody's name ends in `.jpg`.
 */
export function normalizeFileName(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_\-.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The same normalisation for a roster name, so both sides compare alike. */
export function normalizeStudentName(name: string): string {
  return name
    .replace(/[_\-.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** A student the matcher may choose from. */
export interface MatchableStudent {
  id: number;
  name: string;
  /**
   * The id printed into this student’s QR, when they have one.
   *
   * Optional because a roster typed by hand often has blanks, and a student with
   * no id is still gradable -- by file name, as everyone was before the QR.
   */
  studentIdentifier?: string;
}

/** What a file matched, and how sure that is. */
export interface NameMatch {
  studentId?: number;
  studentName?: string;
  /** 0..1. 1 is every name token present; 0 is no match at all. */
  score: number;
  /** True when a second student scored equally — the caller must not auto-assign. */
  isAmbiguous: boolean;
}

/**
 * Matches a file name to a student on the roster.
 *
 * Token containment rather than string equality, because a scan is rarely named
 * exactly: `alice-chen.jpg`, `Chen Alice 01.png` and `quiz1_alice_chen.jpg` should all
 * find Alice Chen. Every token of the student's name must appear in the file name, so
 * a partial surname does not claim a student.
 *
 * Returns the best match with a score, and flags a tie. **Nothing is auto-assigned on
 * a tie or a zero score** — the grader screen leaves those rows for a human, which is
 * the whole reason this returns a score rather than a student.
 */
export function matchStudentByFileName(
  fileName: string,
  students: MatchableStudent[],
): NameMatch {
  const haystack = normalizeFileName(fileName);
  const haystackTokens = new Set(haystack.split(" ").filter(Boolean));

  let best: { student: MatchableStudent; score: number } | undefined;
  let tied = false;

  for (const student of students) {
    const tokens = normalizeStudentName(student.name).split(" ").filter(Boolean);
    if (tokens.length === 0) continue;

    const present = tokens.filter((token) => haystackTokens.has(token)).length;
    // Every token must be present; a partial match scores zero rather than a little,
    // so "chen" alone cannot claim "Alice Chen" over "Bob Chen".
    const score = present === tokens.length ? present / tokens.length : 0;
    if (score === 0) continue;

    if (!best || score > best.score) {
      best = { student, score };
      tied = false;
    } else if (best && score === best.score) {
      tied = true;
    }
  }

  if (!best) return { score: 0, isAmbiguous: false };

  return {
    studentId: tied ? undefined : best.student.id,
    studentName: tied ? undefined : best.student.name,
    score: best.score,
    isAmbiguous: tied,
  };
}
