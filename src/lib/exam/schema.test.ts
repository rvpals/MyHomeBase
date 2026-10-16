import { describe, expect, it } from "vitest";
import {
  MAX_DECLARATION_LENGTH,
  MAX_QUESTION_COUNT,
  createExamSchema,
  isValidChoice,
  saveAnswerKeySchema,
  updateExamSchema,
} from "./schema";
import { DEFAULT_DECLARATION_TEXT, DEFAULT_PROFESSOR_NAME } from "./types";

const valid = {
  examIdentifier: "QUIZ-1",
  name: "Fractions quiz",
  description: "",
  classId: 7,
  questionCount: 10,
  choiceSet: "ABCD" as const,
  pointsPerQuestion: 5,
  printStudentNames: false,
  includeSignature: false,
  includeProfessor: false,
  professorName: "Dr Ting Sun",
  includeStudentId: false,
  includeDeclaration: false,
  declarationText: "",
};

describe("createExamSchema", () => {
  it("accepts a complete exam", () => {
    expect(createExamSchema.parse(valid).name).toBe("Fractions quiz");
  });

  it("defaults the optional text fields to blank, not undefined", () => {
    const parsed = createExamSchema.parse({
      name: "Pop quiz",
      classId: 1,
      questionCount: 5,
    });

    // The columns are NOT NULL with a blank default, so the repository must always
    // have a value to write.
    expect(parsed.examIdentifier).toBe("");
    expect(parsed.description).toBe("");
    expect(parsed.choiceSet).toBe("ABCD");
    expect(parsed.pointsPerQuestion).toBe(1);
  });

  it("trims the name and rejects a blank one", () => {
    expect(createExamSchema.parse({ ...valid, name: "  Quiz  " }).name).toBe("Quiz");
    expect(createExamSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
  });

  it("requires a class", () => {
    expect(createExamSchema.safeParse({ ...valid, classId: 0 }).success).toBe(false);
  });

  it("rejects a question count below 1 or above the cap", () => {
    expect(createExamSchema.safeParse({ ...valid, questionCount: 0 }).success).toBe(false);
    expect(
      createExamSchema.safeParse({ ...valid, questionCount: MAX_QUESTION_COUNT + 1 }).success,
    ).toBe(false);
  });

  it("rejects a choice set it does not know", () => {
    expect(createExamSchema.safeParse({ ...valid, choiceSet: "ABC" }).success).toBe(false);
  });

  it("allows zero points — an ungraded practice sheet", () => {
    expect(createExamSchema.safeParse({ ...valid, pointsPerQuestion: 0 }).success).toBe(true);
  });

  it("rejects negative points", () => {
    expect(createExamSchema.safeParse({ ...valid, pointsPerQuestion: -1 }).success).toBe(false);
  });
});

describe("createExamSchema — answer sheet options", () => {
  it("defaults every option to off, with the professor pre-filled", () => {
    const parsed = createExamSchema.parse({
      name: "Pop quiz",
      classId: 1,
      questionCount: 5,
    });

    expect(parsed.printStudentNames).toBe(false);
    expect(parsed.includeSignature).toBe(false);
    expect(parsed.includeProfessor).toBe(false);
    expect(parsed.includeDeclaration).toBe(false);
    expect(parsed.declarationText).toBe("");
    // Seeded, not blank: the field is editable but starts somewhere useful.
    expect(parsed.professorName).toBe(DEFAULT_PROFESSOR_NAME);
  });

  it("accepts the options when set", () => {
    const parsed = createExamSchema.parse({
      ...valid,
      printStudentNames: true,
      includeSignature: true,
      includeProfessor: true,
      professorName: "  Dr Who  ",
      includeDeclaration: true,
      declarationText: "  Do not distribute.  ",
    });

    expect(parsed.printStudentNames).toBe(true);
    expect(parsed.includeSignature).toBe(true);
    // Both text fields are trimmed, so stray whitespace never reaches the sheet.
    expect(parsed.professorName).toBe("Dr Who");
    expect(parsed.declarationText).toBe("Do not distribute.");
  });

  it("has a default declaration that fits within the cap", () => {
    // The form seeds this when the option is switched on, so it must be a value the
    // schema will actually accept — a default that fails validation would make the
    // checkbox produce an unsaveable exam.
    expect(DEFAULT_DECLARATION_TEXT.length).toBeLessThanOrEqual(MAX_DECLARATION_LENGTH);
    expect(
      createExamSchema.safeParse({
        ...valid,
        includeDeclaration: true,
        declarationText: DEFAULT_DECLARATION_TEXT,
      }).success,
    ).toBe(true);
  });

  it("rejects a declaration longer than the cap", () => {
    // The cap exists because the declaration is the only block whose height the
    // teacher controls, and the sheet has to fit one page.
    const tooLong = "x".repeat(MAX_DECLARATION_LENGTH + 1);

    expect(createExamSchema.safeParse({ ...valid, declarationText: tooLong }).success).toBe(
      false,
    );
    expect(
      createExamSchema.safeParse({ ...valid, declarationText: "x".repeat(MAX_DECLARATION_LENGTH) })
        .success,
    ).toBe(true);
  });

  it("allows a blank professor name — it prints an empty line rather than blocking a save", () => {
    expect(
      createExamSchema.safeParse({ ...valid, includeProfessor: true, professorName: "" }).success,
    ).toBe(true);
  });
});

describe("updateExamSchema", () => {
  it("requires an id", () => {
    expect(updateExamSchema.safeParse(valid).success).toBe(false);
    expect(updateExamSchema.safeParse({ ...valid, id: 3 }).success).toBe(true);
  });
});

describe("saveAnswerKeySchema", () => {
  it("upper-cases a typed answer so lowercase input works", () => {
    const parsed = saveAnswerKeySchema.parse({
      examId: 1,
      answers: [{ questionNumber: 1, correctChoice: "b" }],
    });

    expect(parsed.answers[0].correctChoice).toBe("B");
  });

  it("accepts a blank answer — that clears the question", () => {
    const parsed = saveAnswerKeySchema.parse({
      examId: 1,
      answers: [{ questionNumber: 1, correctChoice: "" }],
    });

    expect(parsed.answers[0].correctChoice).toBe("");
  });

  it("accepts an empty list — saving a key nobody has filled in", () => {
    expect(saveAnswerKeySchema.safeParse({ examId: 1, answers: [] }).success).toBe(true);
  });

  it("rejects a multi-letter answer", () => {
    expect(
      saveAnswerKeySchema.safeParse({
        examId: 1,
        answers: [{ questionNumber: 1, correctChoice: "AB" }],
      }).success,
    ).toBe(false);
  });

  it("rejects the same question twice — that is a caller bug, not last-wins", () => {
    expect(
      saveAnswerKeySchema.safeParse({
        examId: 1,
        answers: [
          { questionNumber: 1, correctChoice: "A" },
          { questionNumber: 1, correctChoice: "B" },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects a question number below 1", () => {
    expect(
      saveAnswerKeySchema.safeParse({
        examId: 1,
        answers: [{ questionNumber: 0, correctChoice: "A" }],
      }).success,
    ).toBe(false);
  });
});

describe("isValidChoice", () => {
  it("accepts a letter the set offers", () => {
    expect(isValidChoice("C", "ABCD")).toBe(true);
  });

  it("rejects a letter beyond the set", () => {
    expect(isValidChoice("E", "ABCD")).toBe(false);
    expect(isValidChoice("E", "ABCDE")).toBe(true);
  });

  it("accepts a blank — unkeyed is not a wrong answer", () => {
    expect(isValidChoice("", "ABCD")).toBe(true);
  });
});
