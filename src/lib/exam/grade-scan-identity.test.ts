import { describe, expect, it } from "vitest";

import { gradeScan } from "./exam";
import type { ExamRepository } from "./ports";
import type { Exam, ExamQuestion } from "./types";

/**
 * Which student a scan is attributed to, and on what evidence.
 *
 * Deliberately separate from the mark-reading tests. This is the one part of grading
 * where being *confidently wrong* attaches a real grade to the wrong person, so it is
 * worth testing on its own rather than as a side effect of a detection test. The
 * bitmap here is blank on purpose: every question reads as blank, which is fine,
 * because nothing below asserts on marks.
 */

const EXAM: Exam = {
  id: 1,
  classId: 10,
  description: "",
  examIdentifier: "TEST-01",
  name: "Midterm",
  questionCount: 2,
  choiceSet: "ABCDE",
  pointsPerQuestion: 1,
  printStudentNames: true,
  includeSignature: false,
  includeProfessor: false,
  professorName: "",
  includeStudentId: true,
  includeDeclaration: false,
  declarationText: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const STAMP = "2026-01-01T00:00:00.000Z";

const KEY: ExamQuestion[] = [
  { id: 1, examId: 1, questionNumber: 1, correctChoice: "A", createdAt: STAMP, updatedAt: STAMP },
  { id: 2, examId: 1, questionNumber: 2, correctChoice: "B", createdAt: STAMP, updatedAt: STAMP },
];

function repoFor(exam: Exam): ExamRepository {
  return {
    getExamById: (id: number) => (id === exam.id ? exam : undefined),
    listQuestions: () => KEY,
  } as unknown as ExamRepository;
}

function blankBitmap(width = 850, height = 1100) {
  return { data: new Uint8Array(width * height * 4).fill(255), width, height };
}

const ROSTER = [
  { id: 7, name: "Alexander Scott Acocella", studentIdentifier: "11046" },
  { id: 8, name: "Bernadette Chan", studentIdentifier: "20194" },
  { id: 9, name: "Casey Nolan", studentIdentifier: "" },
];

describe("gradeScan student identity", () => {
  it("uses the QR id when it matches a student on the roster", () => {
    const result = gradeScan(
      repoFor(EXAM),
      1,
      // A file name that matches nobody, so only the QR can identify this.
      "scan_0007.jpg",
      blankBitmap(),
      0.45,
      ROSTER,
      "20194",
    );

    expect(result.studentId).toBe(8);
    expect(result.studentName).toBe("Bernadette Chan");
    expect(result.identifiedBy).toBe("qr");
    expect(result.needsStudent).toBe(false);
  });

  it("prefers the QR over a file name that points at someone else", () => {
    // The case this whole mechanism exists for: a scanner that reuses file names, or
    // sheets photographed out of order. The printed code wins, because it was
    // generated from the roster and the file name is whatever the scanner chose.
    const result = gradeScan(
      repoFor(EXAM),
      1,
      "Acocella_Alexander_Scott.jpg",
      blankBitmap(),
      0.45,
      ROSTER,
      "20194",
    );

    expect(result.studentName).toBe("Bernadette Chan");
    expect(result.identifiedBy).toBe("qr");
  });

  it("falls back to the file name when no QR was read", () => {
    const result = gradeScan(
      repoFor(EXAM),
      1,
      "Acocella_Alexander_Scott.jpg",
      blankBitmap(),
      0.45,
      ROSTER,
      undefined,
    );

    expect(result.studentId).toBe(7);
    expect(result.identifiedBy).toBe("file-name");
  });

  it("falls back to the file name when the QR id is not on this roster", () => {
    // A sheet from another class, or a stale printout after a roster change. The id
    // decoded cleanly but means nothing here, so it must not be trusted.
    const result = gradeScan(
      repoFor(EXAM),
      1,
      "Acocella_Alexander_Scott.jpg",
      blankBitmap(),
      0.45,
      ROSTER,
      "99999",
    );

    expect(result.studentId).toBe(7);
    expect(result.identifiedBy).toBe("file-name");
  });

  it("does not match a student whose identifier is blank", () => {
    // Casey Nolan has no id. An empty scanned identifier must not match them by
    // accident — two students with no id would both "match", silently.
    const result = gradeScan(
      repoFor(EXAM),
      1,
      "unknown.jpg",
      blankBitmap(),
      0.45,
      ROSTER,
      "",
    );

    expect(result.studentId).toBeUndefined();
    expect(result.identifiedBy).toBe("none");
    expect(result.needsStudent).toBe(true);
  });

  it("reports none when neither the QR nor the file name identifies anyone", () => {
    const result = gradeScan(
      repoFor(EXAM),
      1,
      "scan_0007.jpg",
      blankBitmap(),
      0.45,
      ROSTER,
      undefined,
    );

    expect(result.studentId).toBeUndefined();
    expect(result.identifiedBy).toBe("none");
    expect(result.needsStudent).toBe(true);
  });
});
