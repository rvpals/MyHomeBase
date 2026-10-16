import { describe, expect, it } from "vitest";
import type { DetectedAnswer } from "./detect-marks";
import {
  gradeSheet,
  matchStudentByFileName,
  normalizeFileName,
  normalizeStudentName,
} from "./grading";
import type { ExamQuestion } from "./types";

function detected(
  questionNumber: number,
  choice: string,
  issue: DetectedAnswer["issue"] = "none",
): DetectedAnswer {
  return { questionNumber, choice, confidence: 0.9, issue, darkness: [] };
}

function keyed(questionNumber: number, correctChoice: string): ExamQuestion {
  return {
    id: questionNumber,
    examId: 1,
    questionNumber,
    correctChoice,
    createdAt: "",
    updatedAt: "",
  };
}

describe("gradeSheet", () => {
  const key = [keyed(1, "A"), keyed(2, "B"), keyed(3, "C"), keyed(4, "D")];

  it("scores a perfect sheet", () => {
    const result = gradeSheet(
      [detected(1, "A"), detected(2, "B"), detected(3, "C"), detected(4, "D")],
      key,
      5,
    );

    expect(result.correctCount).toBe(4);
    expect(result.score).toBe(20);
    expect(result.maxScore).toBe(20);
    expect(result.flaggedCount).toBe(0);
  });

  it("scores a partly wrong sheet", () => {
    const result = gradeSheet(
      [detected(1, "A"), detected(2, "C"), detected(3, "C"), detected(4, "A")],
      key,
      5,
    );

    expect(result.correctCount).toBe(2);
    expect(result.score).toBe(10);
    expect(result.answers[1].isCorrect).toBe(false);
    expect(result.answers[1].correct).toBe("B");
  });

  it("scores a blank answer as wrong, not as a skip", () => {
    const result = gradeSheet(
      [detected(1, "A"), detected(2, "", "blank"), detected(3, "C"), detected(4, "D")],
      key,
      5,
    );

    expect(result.correctCount).toBe(3);
    expect(result.score).toBe(15);
  });

  it("scores an ambiguous answer as wrong and flags it", () => {
    const result = gradeSheet(
      [detected(1, "A"), detected(2, "", "multiple"), detected(3, "C"), detected(4, "D")],
      key,
      5,
    );

    expect(result.correctCount).toBe(3);
    expect(result.flaggedCount).toBe(1);
  });

  it("never counts an unkeyed question correct, even for a blank sheet", () => {
    // Question 2 has no answer in the key.
    const partialKey = [keyed(1, "A"), keyed(2, ""), keyed(3, "C"), keyed(4, "D")];
    const result = gradeSheet(
      [detected(1, "A"), detected(2, "", "blank"), detected(3, "C"), detected(4, "D")],
      partialKey,
      5,
    );

    expect(result.answers[1].isCorrect).toBe(false);
    expect(result.correctCount).toBe(3);
  });

  it("treats a question missing from the key as unkeyed", () => {
    const result = gradeSheet([detected(1, "A"), detected(2, "B")], [keyed(1, "A")], 10);

    expect(result.answers[1].correct).toBe("");
    expect(result.answers[1].isCorrect).toBe(false);
    expect(result.score).toBe(10);
  });

  it("counts every issue towards the flagged total", () => {
    const result = gradeSheet(
      [
        detected(1, "A"),
        detected(2, "", "blank"),
        detected(3, "C", "faint"),
        detected(4, "", "multiple"),
      ],
      key,
      1,
    );

    expect(result.flaggedCount).toBe(3);
  });

  it("handles zero points — an ungraded practice sheet", () => {
    const result = gradeSheet([detected(1, "A")], key, 0);

    expect(result.correctCount).toBe(1);
    expect(result.score).toBe(0);
    expect(result.maxScore).toBe(0);
  });
});

describe("normalizeFileName", () => {
  it("drops the extension and splits separators into words", () => {
    expect(normalizeFileName("alice-chen.jpg")).toBe("alice chen");
    expect(normalizeFileName("Chen, Alice_quiz1.JPG")).toBe("chen alice quiz1");
    expect(normalizeFileName("scan.01.bob.smith.png")).toBe("scan 01 bob smith");
  });

  it("leaves a name with no extension alone", () => {
    expect(normalizeFileName("alice chen")).toBe("alice chen");
  });
});

describe("normalizeStudentName", () => {
  it("lower-cases and collapses whitespace", () => {
    expect(normalizeStudentName("  Alice   Chen ")).toBe("alice chen");
    expect(normalizeStudentName("O'Brien, Pat")).toBe("o'brien pat");
  });
});

describe("matchStudentByFileName", () => {
  const roster = [
    { id: 1, name: "Alice Chen" },
    { id: 2, name: "Bob Chen" },
    { id: 3, name: "Cara Diaz" },
  ];

  it("matches a hyphenated file name", () => {
    const match = matchStudentByFileName("alice-chen.jpg", roster);

    expect(match.studentId).toBe(1);
    expect(match.score).toBe(1);
    expect(match.isAmbiguous).toBe(false);
  });

  it("matches regardless of name order or extra tokens", () => {
    expect(matchStudentByFileName("quiz1_chen_alice_01.png", roster).studentId).toBe(1);
    expect(matchStudentByFileName("Chen, Cara.jpg", roster).studentId).toBeUndefined();
    expect(matchStudentByFileName("Diaz Cara scan.jpg", roster).studentId).toBe(3);
  });

  it("does not let a shared surname claim a student", () => {
    // "chen" alone matches neither Alice nor Bob fully, so nothing is assigned.
    const match = matchStudentByFileName("chen.jpg", roster);

    expect(match.studentId).toBeUndefined();
    expect(match.score).toBe(0);
  });

  it("reports an ambiguous match rather than guessing", () => {
    const twins = [
      { id: 1, name: "Alice Chen" },
      { id: 2, name: "Chen Alice" },
    ];
    const match = matchStudentByFileName("alice-chen.jpg", twins);

    expect(match.isAmbiguous).toBe(true);
    expect(match.studentId).toBeUndefined();
  });

  it("returns no match for a file named after nobody", () => {
    const match = matchStudentByFileName("IMG_4821.jpg", roster);

    expect(match.studentId).toBeUndefined();
    expect(match.score).toBe(0);
  });

  it("ignores a roster entry with a blank name", () => {
    const match = matchStudentByFileName("alice-chen.jpg", [{ id: 9, name: "   " }, ...roster]);

    expect(match.studentId).toBe(1);
  });
});
