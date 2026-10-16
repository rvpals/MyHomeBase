"use client";

// Exam Maker: the New Exam card, then the New Answer card.
//
// Two cards on one screen rather than two sections, because the second depends on the
// first: how many answer rows there are, and which letters each offers, come from the
// question count and choice set above. Keeping them together is what makes that
// dependency visible — and it is why shrinking an exam warns about the answers it
// discards rather than silently dropping them.
//
// A new exam must be SAVED before its key can be entered: a key row needs an exam id
// to attach to. So the New Answer card is disabled until the exam exists, and saving
// the first card routes to `?edit=<id>`.

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import {
  CHOICE_SETS,
  DEFAULT_CHOICE_SET,
  DEFAULT_DECLARATION_TEXT,
  DEFAULT_PROFESSOR_NAME,
  MAX_DECLARATION_LENGTH,
  MAX_POINTS_PER_QUESTION,
  MAX_QUESTION_COUNT,
  buildSheetLayout,
  choiceLetters,
  type ChoiceSet,
  type ExamQuestion,
  type ExamWithKey,
} from "@/lib/exam";
import { ExamAnswerSheet, headerHeight } from "./exam-answer-sheet";
import { createExamAction, saveAnswerKeyAction, updateExamAction } from "./exam-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const LABEL_CLASS = "text-xs font-medium uppercase tracking-wide text-muted";

const EXAM_PATH = "/modules/classroom/exam";
const MAKER_PATH = "/modules/classroom/exam-maker";

export interface ExamMakerClass {
  id: number;
  name: string;
}

export function ExamMakerView({
  classes,
  rosterByClassId,
  qrSvgByIdentifier,
  loaded,
}: {
  classes: ExamMakerClass[];
  /**
   * classId -> the names of the students enrolled in it, loaded server-side.
   *
   * Needed up front rather than fetched on demand because the preview says how many
   * sheets option (a) will print, and that has to update the moment the class
   * changes.
   */
  rosterByClassId: Record<number, { name: string; studentIdentifier: string }[]>;
  /**
   * Each student id rendered as a QR, keyed by identifier.
   *
   * Built server-side because generating one is async and this render is not. A
   * student with no id has no entry, and their sheet prints without a code.
   */
  qrSvgByIdentifier: Record<string, string>;
  /** The exam being edited, or `undefined` when creating a new one. */
  loaded?: ExamWithKey;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  // The New Exam card's fields.
  //
  // `classId` starts at the loaded exam's class, else the first class in the list —
  // never a value no <option> carries. A <select> whose value matches no option
  // displays the first one anyway, so render and state would silently disagree; the
  // default has to be WRITTEN to state, not merely rendered.
  const [examIdentifier, setExamIdentifier] = useState(loaded?.exam.examIdentifier ?? "");
  const [name, setName] = useState(loaded?.exam.name ?? "");
  const [description, setDescription] = useState(loaded?.exam.description ?? "");
  const [classId, setClassId] = useState<number>(
    loaded?.exam.classId ?? classes[0]?.id ?? 0,
  );
  const [questionCount, setQuestionCount] = useState(loaded?.exam.questionCount ?? 10);
  const [choiceSet, setChoiceSet] = useState<ChoiceSet>(
    loaded?.exam.choiceSet ?? DEFAULT_CHOICE_SET,
  );
  const [pointsPerQuestion, setPointsPerQuestion] = useState(
    loaded?.exam.pointsPerQuestion ?? 1,
  );

  // The answer-sheet options (a)-(d). Each is persisted on the exam, so they survive
  // a reprint and nobody retypes the professor or the declaration.
  const [printStudentNames, setPrintStudentNames] = useState(
    loaded?.exam.printStudentNames ?? false,
  );
  const [includeSignature, setIncludeSignature] = useState(
    loaded?.exam.includeSignature ?? false,
  );
  const [includeProfessor, setIncludeProfessor] = useState(
    loaded?.exam.includeProfessor ?? false,
  );
  const [professorName, setProfessorName] = useState(
    loaded?.exam.professorName || DEFAULT_PROFESSOR_NAME,
  );
  const [includeStudentId, setIncludeStudentId] = useState(
    loaded?.exam.includeStudentId ?? false,
  );
  const [includeDeclaration, setIncludeDeclaration] = useState(
    loaded?.exam.includeDeclaration ?? false,
  );
  const [declarationText, setDeclarationText] = useState(
    loaded?.exam.declarationText ?? "",
  );

  // The New Answer card's state: question number -> chosen letter.
  //
  // Seeded from the saved key. A question with no answer holds "", which is the
  // "not keyed yet" value rather than a missing entry — a partial key is savable.
  const [answers, setAnswers] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      (loaded?.questions ?? []).map((question: ExamQuestion) => [
        question.questionNumber,
        question.correctChoice,
      ]),
    ),
  );

  const [isPrinting, setIsPrinting] = useState(false);

  const isEditing = loaded !== undefined;

  // The preview and the printed sheet are built from the SAME object, so what is on
  // screen is what comes out of the printer.
  const previewExam = {
    examIdentifier,
    name,
    className: classes.find((item) => item.id === classId)?.name ?? "",
    questionCount: Math.max(1, questionCount || 1),
    choiceSet,
    pointsPerQuestion,
    printStudentNames,
    includeSignature,
    includeProfessor,
    professorName,
    includeStudentId,
    includeDeclaration,
    declarationText,
  };

  // Laid out with the header the current options produce, which is what decides
  // whether the questions still fit one page.
  const previewLayout = buildSheetLayout(
    previewExam.questionCount,
    choiceSet,
    headerHeight(previewExam),
  );

  const students = rosterByClassId[classId] ?? [];
  const rosterCount = students.length;

  /**
   * Prints the sheets for the exam as currently configured.
   *
   * Same ordering as the Exam Home screen's print: mount the sheets, let React
   * commit, then call `window.print()` — which is synchronous, so it has to run after
   * the commit. Two chained frames is the cheapest dependable point.
   */
  function handlePrintPreview() {
    setIsPrinting(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  }

  // Unmount the sheets once the print dialog closes, so a later Ctrl+P prints the
  // screen rather than silently reprinting a stale run.
  useEffect(() => {
    if (!isPrinting) return;
    const clear = () => setIsPrinting(false);
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, [isPrinting]);
  const letters = choiceLetters(choiceSet);
  // The saved count, not the edited one: the answer rows reflect what is stored, so
  // the card does not grow rows for questions the exam does not have yet.
  const savedQuestionCount = loaded?.exam.questionCount ?? 0;
  const keyedCount = Object.values(answers).filter((choice) => choice !== "").length;

  function handleSaveExam() {
    setError(undefined);
    setNotice(undefined);

    const input = {
      examIdentifier,
      name,
      description,
      classId,
      questionCount,
      choiceSet,
      pointsPerQuestion,
      printStudentNames,
      includeSignature,
      includeProfessor,
      professorName,
      includeStudentId,
      includeDeclaration,
      declarationText,
    };

    startTransition(async () => {
      if (isEditing) {
        const result = await updateExamAction({ ...input, id: loaded.exam.id });
        if (!result.ok) {
          setError(result.error ?? "Failed to save the exam.");
          return;
        }
        // Say what reconciling the key cost, rather than letting answers vanish
        // quietly.
        const costs: string[] = [];
        if (result.discardedAnswers) {
          costs.push(
            `${result.discardedAnswers} answer${result.discardedAnswers === 1 ? "" : "s"} beyond question ${questionCount} ${result.discardedAnswers === 1 ? "was" : "were"} discarded`,
          );
        }
        if (result.invalidatedAnswers) {
          costs.push(
            `${result.invalidatedAnswers} answer${result.invalidatedAnswers === 1 ? "" : "s"} no longer offered by ${choiceSet} ${result.invalidatedAnswers === 1 ? "was" : "were"} cleared`,
          );
        }
        setNotice(costs.length > 0 ? `Saved — ${costs.join(", and ")}.` : "Saved.");
        router.refresh();
        return;
      }

      const result = await createExamAction(input);
      if (!result.ok) {
        setError(result.error ?? "Failed to create the exam.");
        return;
      }
      // Route to the saved exam so the New Answer card has an id to attach to.
      router.push(`${MAKER_PATH}?edit=${result.examId}`);
    });
  }

  function handleSaveKey() {
    setError(undefined);
    setNotice(undefined);
    if (!isEditing) return;

    startTransition(async () => {
      const result = await saveAnswerKeyAction({
        examId: loaded.exam.id,
        answers: Object.entries(answers).map(([questionNumber, correctChoice]) => ({
          questionNumber: Number(questionNumber),
          correctChoice,
        })),
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to save the answer key.");
        return;
      }
      setNotice("Answer key saved.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {notice && <p className="text-sm text-muted">{notice}</p>}

      <CollapsibleCard title={isEditing ? "Exam" : "New Exam"} defaultOpen>
        <div className="flex flex-col gap-3">
          {/* Two columns on a wide screen, one on a phone — max-lg: first, so the
              desktop classes are untouched. */}
          <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
            <label className="flex flex-col gap-1">
              <span className={LABEL_CLASS}>Class</span>
              <select
                className={INPUT_CLASS}
                value={classId}
                onChange={(event) => setClassId(Number(event.target.value))}
                disabled={pending}
              >
                {classes.length === 0 && <option value={0}>No classes yet</option>}
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className={LABEL_CLASS}>Exam ID</span>
              <input
                className={INPUT_CLASS}
                value={examIdentifier}
                onChange={(event) => setExamIdentifier(event.target.value)}
                placeholder="QUIZ-1"
                disabled={pending}
              />
              <span className="text-xs text-muted">
                Your own label for this exam. It prints on the answer sheet.
              </span>
            </label>

            <label className="flex flex-col gap-1">
              <span className={LABEL_CLASS}>Name</span>
              <input
                className={INPUT_CLASS}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Fractions quiz"
                disabled={pending}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className={LABEL_CLASS}>Description</span>
              <input
                className={INPUT_CLASS}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={pending}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className={LABEL_CLASS}>Questions</span>
              <input
                className={INPUT_CLASS}
                type="number"
                min={1}
                max={MAX_QUESTION_COUNT}
                value={questionCount}
                onChange={(event) => setQuestionCount(Number(event.target.value))}
                disabled={pending}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className={LABEL_CLASS}>Multiple choices</span>
              <select
                className={INPUT_CLASS}
                value={choiceSet}
                onChange={(event) => setChoiceSet(event.target.value as ChoiceSet)}
                disabled={pending}
              >
                {CHOICE_SETS.map((set) => (
                  <option key={set} value={set}>
                    {set.split("").join(" ")}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className={LABEL_CLASS}>Points per correct answer</span>
              <input
                className={INPUT_CLASS}
                type="number"
                min={0}
                max={MAX_POINTS_PER_QUESTION}
                value={pointsPerQuestion}
                onChange={(event) => setPointsPerQuestion(Number(event.target.value))}
                disabled={pending}
              />
            </label>
          </div>

          {isEditing && questionCount < savedQuestionCount && (
            <p className="text-sm text-danger">
              Saving will discard the answers for questions {questionCount + 1}–
              {savedQuestionCount}.
            </p>
          )}

          {/* The answer-sheet options. Saved on the exam, so a reprint keeps them. */}
          <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3">
            <legend className={`px-1 ${LABEL_CLASS}`}>Answer sheet options</legend>

            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-1"
                checked={printStudentNames}
                onChange={(event) => setPrintStudentNames(event.target.checked)}
                disabled={pending}
              />
              <span>
                Print each student&apos;s name
                <span className="block text-xs text-muted">
                  One sheet per enrolled student, already named — so the number of sheets
                  is the class roster rather than a number you type.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-1"
                checked={includeStudentId}
                onChange={(event) => setIncludeStudentId(event.target.checked)}
                disabled={pending}
              />
              <span>
                Print a student ID QR code
                <span className="block text-xs text-muted">
                  Each student&apos;s ID as a small square code. The grader reads it off the
                  scan, so a sheet says who it belongs to even if the file is renamed.
                  Error-corrected, so a crease or a smudge either reads correctly or fails
                  loudly &mdash; it cannot quietly become someone else&apos;s ID.
                </span>
              </span>
            </label>
            {includeStudentId && !printStudentNames && (
              <p className="ml-6 text-xs text-danger">
                Switch on &ldquo;Print each student&apos;s name&rdquo; too, or no code is
                printed &mdash; one sheet per student is what tells the app whose ID to
                encode.
              </p>
            )}

            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-1"
                checked={includeSignature}
                onChange={(event) => setIncludeSignature(event.target.checked)}
                disabled={pending}
              />
              <span>
                Add a signature field
                <span className="block text-xs text-muted">A signature line in the header.</span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-1"
                checked={includeProfessor}
                onChange={(event) => setIncludeProfessor(event.target.checked)}
                disabled={pending}
              />
              <span>Add the professor&apos;s name</span>
            </label>
            {includeProfessor && (
              <input
                className={`${INPUT_CLASS} ml-6 w-[calc(100%-1.5rem)]`}
                value={professorName}
                onChange={(event) => setProfessorName(event.target.value)}
                placeholder={DEFAULT_PROFESSOR_NAME}
                disabled={pending}
              />
            )}

            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-1"
                checked={includeDeclaration}
                onChange={(event) => {
                  setIncludeDeclaration(event.target.checked);
                  // Seed the wording the first time it is switched on, so the box is
                  // genuinely filled rather than just showing a grey hint — a
                  // placeholder saves as an empty declaration, which still prints its
                  // border and reads as a mistake.
                  //
                  // Only when empty: switching the option off and on again must never
                  // overwrite wording that has been edited.
                  if (event.target.checked && declarationText.trim() === "") {
                    setDeclarationText(DEFAULT_DECLARATION_TEXT);
                  }
                }}
                disabled={pending}
              />
              <span>
                Add a declaration
                <span className="block text-xs text-muted">
                  Printed as a block just above the answers.
                </span>
              </span>
            </label>
            {includeDeclaration && (
              <div className="ml-6 w-[calc(100%-1.5rem)]">
                <textarea
                  className={`${INPUT_CLASS} min-h-20`}
                  value={declarationText}
                  maxLength={MAX_DECLARATION_LENGTH}
                  onChange={(event) => setDeclarationText(event.target.value)}
                  placeholder="I agree not to distribute, reproduce or share this exam in any form."
                  disabled={pending}
                />
                <span className="text-xs text-muted">
                  {declarationText.length}/{MAX_DECLARATION_LENGTH} characters. Longer text
                  leaves less room for the answers, which must fit one page.
                </span>
              </div>
            )}
          </fieldset>

          <div className="flex items-center justify-between gap-2">
            {/* No `disabled` — `Button` ignores it on the `href` branch, which renders
                a next/link. Passing it would read as a guard that isn't there. */}
            <Button variant="secondary" href={EXAM_PATH}>
              Back to exams
            </Button>
            <Button onClick={handleSaveExam} disabled={pending || classes.length === 0}>
              {isEditing ? "Save exam" : "Create exam"}
            </Button>
          </div>

          {classes.length === 0 && (
            <p className="text-sm text-danger">
              Create a class first — an exam is graded against a class roster.
            </p>
          )}
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        title="New Answer"
        defaultOpen={isEditing}
      >
        {!isEditing ? (
          <p className="text-sm text-muted">
            Create the exam first. The answer key attaches to it, so it needs the exam to
            exist.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Pick or type the correct answer for each question. {keyedCount} of{" "}
              {savedQuestionCount} answered — a partial key saves fine, but grading needs
              all of them.
            </p>

            {/* A column of rows: wide enough to scan, and it reflows to one column on a
                phone without a different component. */}
            <div className="grid grid-cols-4 gap-2 max-lg:grid-cols-2">
              {Array.from({ length: savedQuestionCount }, (_, index) => index + 1).map(
                (questionNumber) => (
                  <label key={questionNumber} className="flex items-center gap-2">
                    <span className="w-8 shrink-0 text-right text-sm text-muted">
                      {questionNumber}.
                    </span>
                    <select
                      className={INPUT_CLASS}
                      value={answers[questionNumber] ?? ""}
                      onChange={(event) =>
                        setAnswers((previous) => ({
                          ...previous,
                          [questionNumber]: event.target.value,
                        }))
                      }
                      disabled={pending}
                    >
                      {/* The blank is a real option: it means "not keyed yet", so a
                          teacher can un-answer a question keyed by mistake. */}
                      <option value="">—</option>
                      {letters.map((letter) => (
                        <option key={letter} value={letter}>
                          {letter}
                        </option>
                      ))}
                    </select>
                  </label>
                ),
              )}
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSaveKey} disabled={pending}>
                Save answer key
              </Button>
            </div>
          </div>
        )}
      </CollapsibleCard>

      {/* Preview. Built from the SAME component the printer uses, with the form's
          current values rather than the saved ones — so a checkbox shows its effect
          before anything is saved. */}
      <CollapsibleCard title="Answer sheet preview" defaultOpen>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {previewLayout.columnCount} column
              {previewLayout.columnCount === 1 ? "" : "s"} · {questionCount} question
              {questionCount === 1 ? "" : "s"} · one page.
              {printStudentNames &&
                ` ${rosterCount} sheet${rosterCount === 1 ? "" : "s"} will print, one per enrolled student.`}
            </p>
            <Button onClick={handlePrintPreview} disabled={!previewLayout.fitsOnePage}>
              Print
            </Button>
          </div>

          {!previewLayout.fitsOnePage && (
            <p role="alert" className="text-sm text-danger">
              {questionCount} questions will not fit one page with these options. Reduce the
              question count, or shorten the declaration, before printing.
            </p>
          )}

          {printStudentNames && rosterCount === 0 && (
            <p className="text-sm text-danger">
              No students are enrolled in this class, so there is nobody to print a named
              sheet for. One blank sheet is previewed instead.
            </p>
          )}

          {/* The preview is the real sheet, scaled down. `pointer-events-none` so it
              reads as a picture rather than something to fill in. */}
          <div className="overflow-hidden rounded-md border border-line bg-paper-raised p-3">
            <div className="pointer-events-none mx-auto max-w-[34rem]">
              <ExamAnswerSheet exam={previewExam} copies={1} />
            </div>
          </div>
        </div>
      </CollapsibleCard>

      {/* The sheets actually printed. Mounted only during a print run and hidden on
          screen — `window.print()` reads the layout, not the viewport. */}
      {isPrinting && (
        <div className="hidden print:block">
          <ExamAnswerSheet
            exam={previewExam}
            copies={1}
            students={students}
            qrSvgByIdentifier={qrSvgByIdentifier}
          />
        </div>
      )}
    </div>
  );
}
