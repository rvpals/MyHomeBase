import {
  getExamWithKey,
  keyCompleteness,
  listExams,
  saveAnswerKey,
  type ExamSummary,
} from "@/lib/exam";
import { listClasses } from "@/lib/attendance";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";
import { parseFlags } from "./parse-flags";

/**
 * Lists exams and their answer keys — the terminal counterpart of the Exam Home
 * screen and the Exam Maker's answer card.
 *
 *   exams
 *   exams --class "Math 101"
 *   exams --exam 3
 *   exams --exam 3 --set-key "A,B,C,D"
 *
 * Driving the same use-cases the web app does, per ARCHITECTURE.md: adding this
 * command required no change to `lib/exam`. `--set-key` takes answers in question
 * order, and a blank entry leaves that question unkeyed — `"A,,C"` keys 1 and 3 and
 * clears 2, which is exactly what the screen's blank option does.
 */
export async function examsCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (flags.exam) {
    printOneExam(Number(flags.exam), flags["set-key"]);
    return;
  }

  const classFilter = flags.class;
  let classId: number | undefined;
  if (classFilter) {
    const match = listClasses(deps.attendanceRepo).find(
      (item) => item.name.toLowerCase() === classFilter.toLowerCase(),
    );
    if (!match) {
      console.error(`No class named "${classFilter}".`);
      process.exitCode = 1;
      return;
    }
    classId = match.id;
  }

  const exams = listExams(deps.examRepo, classId);
  if (exams.length === 0) {
    console.log(classFilter ? `No exams for ${classFilter}.` : "No exams yet.");
    return;
  }

  console.log(`${exams.length} exam${exams.length === 1 ? "" : "s"}:`);
  for (const exam of exams) {
    console.log(`  ${formatSummary(exam)}`);
  }
}

function formatSummary(exam: ExamSummary): string {
  const label = exam.examIdentifier ? `${exam.examIdentifier} — ` : "";
  const key =
    exam.keyedCount >= exam.questionCount
      ? "key complete"
      : `key ${exam.keyedCount}/${exam.questionCount}`;
  return `#${exam.id} ${label}${exam.name} (${exam.className || "no class"}) · ${exam.questionCount} questions · ${exam.choiceSet} · ${exam.pointsPerQuestion} pt each · ${key}`;
}

function printOneExam(examId: number, setKey: string | undefined): void {
  if (!Number.isFinite(examId) || examId <= 0) {
    console.error("Usage: exams --exam <id> [--set-key \"A,B,C\"]");
    process.exitCode = 1;
    return;
  }

  try {
    if (setKey !== undefined) {
      // Answers in question order; a blank entry clears that question.
      const answers = setKey.split(",").map((choice, index) => ({
        questionNumber: index + 1,
        correctChoice: choice.trim().toUpperCase(),
      }));
      saveAnswerKey(deps.examRepo, { examId, answers });
      console.log(`Saved ${answers.length} answer${answers.length === 1 ? "" : "s"}.`);
    }

    const { exam, questions } = getExamWithKey(deps.examRepo, examId);
    const completeness = keyCompleteness(deps.examRepo, examId);

    console.log(`#${exam.id} ${exam.examIdentifier ? `${exam.examIdentifier} — ` : ""}${exam.name}`);
    if (exam.description) console.log(`  ${exam.description}`);
    console.log(
      `  ${exam.questionCount} questions · choices ${exam.choiceSet} · ${exam.pointsPerQuestion} point${exam.pointsPerQuestion === 1 ? "" : "s"} each`,
    );
    console.log(
      `  Maximum score: ${exam.questionCount * exam.pointsPerQuestion}`,
    );
    console.log(
      completeness.isComplete
        ? "  Answer key: complete"
        : `  Answer key: ${completeness.keyedCount}/${completeness.questionCount} — missing ${completeness.missingQuestionNumbers.join(", ")}`,
    );
    console.log("  Key:");
    for (const question of questions) {
      console.log(
        `    ${String(question.questionNumber).padStart(3)}. ${question.correctChoice || "—"}`,
      );
    }
  } catch (error) {
    console.error(messageOf(error));
    process.exitCode = 1;
  }
}
