import { describe, expect, it } from "vitest";
import type { ExamRepository } from "./ports";
import type { AnswerWriteData, ExamWriteData } from "./schema";
import {
  ExamValidationError,
  createExam,
  deleteExam,
  getExamWithKey,
  keyCompleteness,
  listExams,
  saveAnswerKey,
  updateExam,
} from "./exam";
import type { Exam, ExamQuestion, ExamSummary } from "./types";

/**
 * A hand-written in-memory repository, per ARCHITECTURE.md's "fakes over mocks".
 *
 * It enforces the one thing the real table enforces — the unique index on
 * `(exam_id, question_number)`, via the `questions` map key — so a test that would
 * write two rows for one question fails here too.
 */
function fakeRepo(seed: Exam[] = [], seedQuestions: ExamQuestion[] = []) {
  const exams = new Map<number, Exam>(seed.map((exam) => [exam.id, exam]));
  // Keyed "examId:questionNumber", mirroring the unique index.
  const questions = new Map<string, ExamQuestion>(
    seedQuestions.map((question) => [`${question.examId}:${question.questionNumber}`, question]),
  );
  let nextExamId = Math.max(0, ...seed.map((exam) => exam.id)) + 1;
  let nextQuestionId = Math.max(0, ...seedQuestions.map((question) => question.id)) + 1;

  const toExam = (id: number, input: ExamWriteData, createdAt: string): Exam => ({
    id,
    examIdentifier: input.examIdentifier,
    name: input.name,
    description: input.description,
    classId: input.classId,
    questionCount: input.questionCount,
    choiceSet: input.choiceSet,
    pointsPerQuestion: input.pointsPerQuestion,
    printStudentNames: input.printStudentNames,
    includeSignature: input.includeSignature,
    includeProfessor: input.includeProfessor,
    professorName: input.professorName,
    includeStudentId: input.includeStudentId,
    includeDeclaration: input.includeDeclaration,
    declarationText: input.declarationText,
    createdAt,
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  const repo: ExamRepository & {
    questionsFor: (examId: number) => ExamQuestion[];
  } = {
    listExams: (classId?: number) =>
      [...exams.values()]
        .filter((exam) => classId === undefined || exam.classId === classId)
        .map<ExamSummary>((exam) => ({
          ...exam,
          className: `Class ${exam.classId}`,
          keyedCount: [...questions.values()].filter(
            (question) => question.examId === exam.id && question.correctChoice !== "",
          ).length,
        })),
    getExamById: (id) => exams.get(id),
    getExamByIdentifier: (classId, examIdentifier) =>
      [...exams.values()].find(
        (exam) =>
          exam.classId === classId &&
          exam.examIdentifier !== "" &&
          exam.examIdentifier.toLowerCase() === examIdentifier.toLowerCase(),
      ),
    createExam: (input) => {
      const exam = toExam(nextExamId, input, "2026-01-01T00:00:00.000Z");
      exams.set(nextExamId, exam);
      nextExamId += 1;
      return exam;
    },
    updateExam: (id, input) => {
      const existing = exams.get(id)!;
      const exam = toExam(id, input, existing.createdAt);
      exams.set(id, exam);
      return exam;
    },
    deleteExam: (id) => {
      exams.delete(id);
      for (const [key, question] of [...questions]) {
        if (question.examId === id) questions.delete(key);
      }
    },
    deleteExams: (ids) => {
      let removed = 0;
      for (const id of ids) {
        if (exams.has(id)) {
          repo.deleteExam(id);
          removed += 1;
        }
      }
      return removed;
    },
    listQuestions: (examId) =>
      [...questions.values()]
        .filter((question) => question.examId === examId)
        .sort((a, b) => a.questionNumber - b.questionNumber),
    saveAnswers: (examId, answers: AnswerWriteData[]) => {
      for (const answer of answers) {
        const key = `${examId}:${answer.questionNumber}`;
        const existing = questions.get(key);
        questions.set(key, {
          id: existing?.id ?? nextQuestionId,
          examId,
          questionNumber: answer.questionNumber,
          correctChoice: answer.correctChoice,
          createdAt: existing?.createdAt ?? "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        });
        if (!existing) nextQuestionId += 1;
      }
    },
    deleteQuestionsAbove: (examId, questionCount) => {
      let removed = 0;
      for (const [key, question] of [...questions]) {
        if (question.examId === examId && question.questionNumber > questionCount) {
          questions.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
    clearAnswersOutsideChoices: (examId, allowedChoices) => {
      let cleared = 0;
      for (const [key, question] of [...questions]) {
        if (
          question.examId === examId &&
          question.correctChoice !== "" &&
          !allowedChoices.includes(question.correctChoice)
        ) {
          questions.set(key, { ...question, correctChoice: "" });
          cleared += 1;
        }
      }
      return cleared;
    },
    questionsFor: (examId) => repo.listQuestions(examId),
  };

  return repo;
}

const baseInput: ExamWriteData = {
  examIdentifier: "QUIZ-1",
  name: "Fractions quiz",
  description: "",
  classId: 7,
  questionCount: 4,
  choiceSet: "ABCD",
  pointsPerQuestion: 5,
  printStudentNames: false,
  includeSignature: false,
  includeProfessor: false,
  professorName: "Dr Ting Sun",
  includeStudentId: false,
  includeDeclaration: false,
  declarationText: "",
};

describe("createExam", () => {
  it("creates an exam", () => {
    const repo = fakeRepo();
    const exam = createExam(repo, baseInput);

    expect(exam.id).toBeGreaterThan(0);
    expect(exam.name).toBe("Fractions quiz");
    expect(listExams(repo)).toHaveLength(1);
  });

  it("rejects a duplicate exam ID within the same class", () => {
    const repo = fakeRepo();
    createExam(repo, baseInput);

    expect(() => createExam(repo, { ...baseInput, name: "Another" })).toThrow(
      ExamValidationError,
    );
  });

  it("matches a duplicate exam ID case-insensitively", () => {
    const repo = fakeRepo();
    createExam(repo, baseInput);

    expect(() => createExam(repo, { ...baseInput, examIdentifier: "quiz-1" })).toThrow(
      ExamValidationError,
    );
  });

  it("allows the same exam ID in a different class", () => {
    const repo = fakeRepo();
    createExam(repo, baseInput);

    expect(() => createExam(repo, { ...baseInput, classId: 9 })).not.toThrow();
  });

  it("allows two unnumbered exams in one class — blank is not a collision", () => {
    const repo = fakeRepo();
    createExam(repo, { ...baseInput, examIdentifier: "" });

    expect(() =>
      createExam(repo, { ...baseInput, examIdentifier: "", name: "Second" }),
    ).not.toThrow();
  });
});

describe("getExamWithKey", () => {
  it("pads unkeyed questions so there is one entry per question", () => {
    const repo = fakeRepo();
    const exam = createExam(repo, baseInput);
    saveAnswerKey(repo, { examId: exam.id, answers: [{ questionNumber: 2, correctChoice: "C" }] });

    const { questions } = getExamWithKey(repo, exam.id);

    expect(questions).toHaveLength(4);
    expect(questions.map((question) => question.questionNumber)).toEqual([1, 2, 3, 4]);
    expect(questions[1].correctChoice).toBe("C");
    // The synthetic rows carry id 0 — they are not saved rows.
    expect(questions[0].id).toBe(0);
    expect(questions[1].id).toBeGreaterThan(0);
  });

  it("throws for an exam that does not exist", () => {
    expect(() => getExamWithKey(fakeRepo(), 404)).toThrow(ExamValidationError);
  });
});

describe("saveAnswerKey", () => {
  it("saves a partial key without complaining", () => {
    const repo = fakeRepo();
    const exam = createExam(repo, baseInput);

    const result = saveAnswerKey(repo, {
      examId: exam.id,
      answers: [{ questionNumber: 1, correctChoice: "A" }],
    });

    expect(result.questions[0].correctChoice).toBe("A");
    expect(result.questions[1].correctChoice).toBe("");
  });

  it("does not clear the rest of the key when saving one answer", () => {
    const repo = fakeRepo();
    const exam = createExam(repo, baseInput);
    saveAnswerKey(repo, {
      examId: exam.id,
      answers: [
        { questionNumber: 1, correctChoice: "A" },
        { questionNumber: 2, correctChoice: "B" },
      ],
    });

    saveAnswerKey(repo, { examId: exam.id, answers: [{ questionNumber: 2, correctChoice: "D" }] });

    const { questions } = getExamWithKey(repo, exam.id);
    expect(questions[0].correctChoice).toBe("A");
    expect(questions[1].correctChoice).toBe("D");
  });

  it("clears an answer when given a blank — un-answering is allowed", () => {
    const repo = fakeRepo();
    const exam = createExam(repo, baseInput);
    saveAnswerKey(repo, { examId: exam.id, answers: [{ questionNumber: 1, correctChoice: "A" }] });

    saveAnswerKey(repo, { examId: exam.id, answers: [{ questionNumber: 1, correctChoice: "" }] });

    expect(getExamWithKey(repo, exam.id).questions[0].correctChoice).toBe("");
  });

  it("rejects a letter the exam's choice set does not offer", () => {
    const repo = fakeRepo();
    const exam = createExam(repo, baseInput);

    expect(() =>
      saveAnswerKey(repo, { examId: exam.id, answers: [{ questionNumber: 1, correctChoice: "E" }] }),
    ).toThrow(ExamValidationError);
  });

  it("accepts E once the exam offers ABCDE", () => {
    const repo = fakeRepo();
    const exam = createExam(repo, { ...baseInput, choiceSet: "ABCDE" });

    expect(() =>
      saveAnswerKey(repo, { examId: exam.id, answers: [{ questionNumber: 1, correctChoice: "E" }] }),
    ).not.toThrow();
  });

  it("rejects a question number beyond the exam's question count", () => {
    const repo = fakeRepo();
    const exam = createExam(repo, baseInput);

    expect(() =>
      saveAnswerKey(repo, { examId: exam.id, answers: [{ questionNumber: 5, correctChoice: "A" }] }),
    ).toThrow(ExamValidationError);
  });
});

describe("updateExam", () => {
  it("discards answers above the new question count, and reports how many", () => {
    const repo = fakeRepo();
    const exam = createExam(repo, baseInput);
    saveAnswerKey(repo, {
      examId: exam.id,
      answers: [
        { questionNumber: 1, correctChoice: "A" },
        { questionNumber: 3, correctChoice: "B" },
        { questionNumber: 4, correctChoice: "C" },
      ],
    });

    const result = updateExam(repo, { ...baseInput, id: exam.id, questionCount: 2 });

    expect(result.discardedAnswers).toBe(2);
    expect(result.invalidatedAnswers).toBe(0);
    expect(getExamWithKey(repo, exam.id).questions).toHaveLength(2);
  });

  it("clears answers the narrowed choice set no longer offers", () => {
    const repo = fakeRepo();
    const exam = createExam(repo, { ...baseInput, choiceSet: "ABCDE" });
    saveAnswerKey(repo, {
      examId: exam.id,
      answers: [
        { questionNumber: 1, correctChoice: "A" },
        { questionNumber: 2, correctChoice: "E" },
      ],
    });

    const result = updateExam(repo, { ...baseInput, id: exam.id, choiceSet: "ABCD" });

    expect(result.invalidatedAnswers).toBe(1);
    const { questions } = getExamWithKey(repo, exam.id);
    expect(questions[0].correctChoice).toBe("A");
    // The question survives, unkeyed — it still exists, it just has no valid answer.
    expect(questions[1].correctChoice).toBe("");
  });

  it("needs no reconciliation when the exam grows", () => {
    const repo = fakeRepo();
    const exam = createExam(repo, baseInput);
    saveAnswerKey(repo, { examId: exam.id, answers: [{ questionNumber: 1, correctChoice: "A" }] });

    const result = updateExam(repo, { ...baseInput, id: exam.id, questionCount: 10 });

    expect(result.discardedAnswers).toBe(0);
    expect(result.invalidatedAnswers).toBe(0);
    expect(getExamWithKey(repo, exam.id).questions).toHaveLength(10);
  });

  it("lets an exam keep its own identifier", () => {
    const repo = fakeRepo();
    const exam = createExam(repo, baseInput);

    expect(() => updateExam(repo, { ...baseInput, id: exam.id, name: "Renamed" })).not.toThrow();
  });

  it("rejects taking another exam's identifier in the same class", () => {
    const repo = fakeRepo();
    createExam(repo, baseInput);
    const second = createExam(repo, { ...baseInput, examIdentifier: "QUIZ-2" });

    expect(() =>
      updateExam(repo, { ...baseInput, id: second.id, examIdentifier: "QUIZ-1" }),
    ).toThrow(ExamValidationError);
  });

  it("throws for an exam that does not exist", () => {
    expect(() => updateExam(fakeRepo(), { ...baseInput, id: 404 })).toThrow(ExamValidationError);
  });
});

describe("keyCompleteness", () => {
  it("reports an incomplete key and which questions are missing", () => {
    const repo = fakeRepo();
    const exam = createExam(repo, baseInput);
    saveAnswerKey(repo, {
      examId: exam.id,
      answers: [
        { questionNumber: 1, correctChoice: "A" },
        { questionNumber: 3, correctChoice: "B" },
      ],
    });

    expect(keyCompleteness(repo, exam.id)).toEqual({
      questionCount: 4,
      keyedCount: 2,
      isComplete: false,
      missingQuestionNumbers: [2, 4],
    });
  });

  it("reports a complete key", () => {
    const repo = fakeRepo();
    const exam = createExam(repo, { ...baseInput, questionCount: 2 });
    saveAnswerKey(repo, {
      examId: exam.id,
      answers: [
        { questionNumber: 1, correctChoice: "A" },
        { questionNumber: 2, correctChoice: "B" },
      ],
    });

    expect(keyCompleteness(repo, exam.id).isComplete).toBe(true);
  });
});

describe("deleteExam", () => {
  it("deletes the exam and its key rows", () => {
    const repo = fakeRepo();
    const exam = createExam(repo, baseInput);
    saveAnswerKey(repo, { examId: exam.id, answers: [{ questionNumber: 1, correctChoice: "A" }] });

    deleteExam(repo, exam.id);

    expect(listExams(repo)).toHaveLength(0);
    expect(repo.listQuestions(exam.id)).toHaveLength(0);
  });

  it("throws for an exam that does not exist", () => {
    expect(() => deleteExam(fakeRepo(), 404)).toThrow(ExamValidationError);
  });
});

describe("listExams", () => {
  it("derives the keyed count per exam", () => {
    const repo = fakeRepo();
    const exam = createExam(repo, baseInput);
    saveAnswerKey(repo, {
      examId: exam.id,
      answers: [
        { questionNumber: 1, correctChoice: "A" },
        // A blank must not count towards the keyed total.
        { questionNumber: 2, correctChoice: "" },
      ],
    });

    expect(listExams(repo)[0].keyedCount).toBe(1);
  });

  it("narrows to one class", () => {
    const repo = fakeRepo();
    createExam(repo, baseInput);
    createExam(repo, { ...baseInput, examIdentifier: "OTHER", classId: 9 });

    expect(listExams(repo, 9)).toHaveLength(1);
    expect(listExams(repo, 9)[0].classId).toBe(9);
  });
});
