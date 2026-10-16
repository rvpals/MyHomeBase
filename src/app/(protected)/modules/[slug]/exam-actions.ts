"use server";

// Server actions for the Classroom module's Exam group.
//
// Thin adapters, per ARCHITECTURE.md: authorise, validate with the module's zod
// schema, call a `lib/exam` use-case, revalidate. No business rule lives here — the
// interesting decisions (identifier uniqueness, what shrinking an exam costs, whether
// a choice is in the set) are all in `src/lib/exam/exam.ts`.

import { revalidatePath } from "next/cache";
import {
  buildSheetLayout,
  cropQrRegion,
  findSheetAnchors,
  scanMapping,
  createExam,
  createExamSchema,
  deleteExam,
  deleteExams,
  decodeStudentIdPayload,
  examIdSchema,
  examIdsSchema,
  saveAnswerKey,
  saveAnswerKeySchema,
  gradeScan,
  updateExam,
  updateExamSchema,
  type GradedScan,
  type QrStatus,
} from "@/lib/exam";
import { formatStudentName, listStudentsInClass } from "@/lib/attendance";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/**
 * The module these actions belong to, matched exactly by `requireModuleAccess`.
 *
 * `classroom`, not `exam`: Exam is a section *group* inside Classroom and owns no
 * module row of its own. A prefix or a route path would not match, and an action is
 * its own POST endpoint — no layout or page check runs before it fires.
 */
const CLASSROOM_MODULE_SLUG = "classroom";

const CLASSROOM_MODULE_PATH = "/modules/classroom";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** An action that created or loaded one exam, so the caller can route to it. */
export interface ExamActionResult extends ActionResult {
  examId?: number;
}

/** What reconciling an edited exam cost, so the screen can say so. */
export interface ExamSaveResult extends ExamActionResult {
  discardedAnswers?: number;
  invalidatedAnswers?: number;
}

/** Both Exam screens, so a write on one refreshes the other. */
function revalidateExams(): void {
  revalidatePath(`${CLASSROOM_MODULE_PATH}/exam`);
  revalidatePath(`${CLASSROOM_MODULE_PATH}/exam-maker`);
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function createExamAction(input: unknown): Promise<ExamActionResult> {
  await requireModuleAccess(CLASSROOM_MODULE_SLUG);
  try {
    const parsed = createExamSchema.parse(input);
    const exam = createExam(deps.examRepo, parsed);
    revalidateExams();
    return { ok: true, examId: exam.id };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to create the exam.") };
  }
}

export async function updateExamAction(input: unknown): Promise<ExamSaveResult> {
  await requireModuleAccess(CLASSROOM_MODULE_SLUG);
  try {
    const parsed = updateExamSchema.parse(input);
    const result = updateExam(deps.examRepo, parsed);
    revalidateExams();
    return {
      ok: true,
      examId: result.exam.id,
      // Reported rather than silent: shrinking an exam destroys recorded answers,
      // and the screen has to be able to say how many.
      discardedAnswers: result.discardedAnswers,
      invalidatedAnswers: result.invalidatedAnswers,
    };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to save the exam.") };
  }
}

export async function deleteExamAction(id: number): Promise<ActionResult> {
  await requireModuleAccess(CLASSROOM_MODULE_SLUG);
  try {
    const parsed = examIdSchema.parse({ id });
    deleteExam(deps.examRepo, parsed.id);
    revalidateExams();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to delete the exam.") };
  }
}

export async function deleteExamsAction(ids: number[]): Promise<ActionResult> {
  await requireModuleAccess(CLASSROOM_MODULE_SLUG);
  try {
    const parsed = examIdsSchema.parse({ ids });
    deleteExams(deps.examRepo, parsed.ids);
    revalidateExams();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to delete the exams.") };
  }
}

export async function saveAnswerKeyAction(input: unknown): Promise<ActionResult> {
  await requireModuleAccess(CLASSROOM_MODULE_SLUG);
  try {
    const parsed = saveAnswerKeySchema.parse(input);
    saveAnswerKey(deps.examRepo, parsed);
    revalidateExams();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to save the answer key.") };
  }
}

/** One graded scan, or why that file could not be graded. */
export interface GradeScanResult extends ActionResult {
  graded?: GradedScan;
}

/**
 * Grades one scanned answer sheet.
 *
 * **One file per call, deliberately.** A server action's payload is capped, and a
 * batch of photographs would blow past it; more importantly, grading twenty sheets in
 * one request means twenty decodes before anything appears on screen, with no way to
 * show progress or to let one bad file fail on its own. The screen calls this once per
 * file and advances its progress bar, so a single unreadable scan is one red row
 * rather than a failed batch.
 *
 * `gridTop` comes from the caller because only the renderer knows how tall the printed
 * header was — it varies with the exam's options, and sampling against the wrong value
 * reads as a sheet of blanks rather than as an error.
 */
export async function gradeScanAction(
  examId: number,
  fileName: string,
  /** The image, base64 — a server action cannot take a File. */
  base64: string,
  gridTop: number,
  /**
   * Where the student-ID QR was printed, from `qrTop`, or undefined if none.
   *
   * Passed in for the same reason `gridTop` is: only the renderer knows how tall the
   * header turned out, and cropping against the wrong band finds nothing.
   */
  qrTopFraction: number | undefined,
): Promise<GradeScanResult> {
  await requireModuleAccess(CLASSROOM_MODULE_SLUG);
  try {
    const exam = deps.examRepo.getExamById(examId);
    if (!exam) return { ok: false, error: `No exam with id ${examId}.` };

    const roster = listStudentsInClass(deps.attendanceRepo, exam.classId).map(
      (student) => ({
        id: student.id,
        name: formatStudentName(student),
        // Matched against the QR when the sheet carries one.
        studentIdentifier: student.studentIdentifier,
      }),
    );

    const bitmap = await deps.sheetImageProcessor.decode(Buffer.from(base64, "base64"));

    // Read the student-ID QR, if this exam prints one.
    //
    // Cropped to the block the layout predicts rather than scanned whole: the answer
    // grid has four solid black corner fiducials, which look enough like QR finder
    // patterns to send the decoder hunting through them.
    //
    // A failure here is not a grading failure. The sheet still grades and still falls
    // back to matching on the file name, which is how every sheet was attributed
    // before the code existed.
    let scannedIdentifier: string | undefined;
    let qrStatus: QrStatus = "not-printed";
    if (exam.includeStudentId && qrTopFraction !== undefined) {
      try {
        // Map through the ANCHOR BARS, not the image edges.
        //
        // A scan is not the page: the scanner leaves margins and the paper lands
        // somewhere inside the image at some scale. Measured on a real 1308x1700
        // scan, the page filled 87% of the width with a 93px left margin -- so the
        // naive `fraction * width` mapping put this crop 83px, 60% of the code width,
        // left of the actual code. It found nothing on every sheet while the answers
        // on the SAME scan read 15/15, because answer detection goes through the
        // anchors and this did not.
        const layout = buildSheetLayout(exam.questionCount, exam.choiceSet, gridTop);
        const anchors = findSheetAnchors(bitmap, layout);
        const mapping = scanMapping(bitmap, layout, anchors);

        const region = cropQrRegion(
          bitmap,
          qrTopFraction,
          mapping.toPixelX,
          mapping.toPixelY,
        );

        if (!region) {
          // The crop fell outside the image entirely.
          qrStatus = "not-found";
        } else {
          const payload = await deps.qrIdentity.decode(region);
          if (payload === undefined) {
            // Nothing in the crop looked like a code. Either it is not there, or the
            // crop is in the wrong place -- which is why the screen says "not found"
            // rather than "unreadable": those point at different fixes.
            qrStatus = "not-found";
          } else {
            scannedIdentifier = decodeStudentIdPayload(payload);
            // A payload that decoded but is not ours, or is malformed, is ink that
            // would not resolve into a student id.
            qrStatus = scannedIdentifier === undefined ? "unreadable" : "decoded";
          }
        }
      } catch {
        // The decoder itself failed -- a missing module, a corrupt buffer. Reported
        // as unreadable rather than swallowed, so the screen never implies the sheet
        // simply had no code.
        qrStatus = "unreadable";
      }
    }
    const graded = gradeScan(
      deps.examRepo,
      examId,
      fileName,
      bitmap,
      gridTop,
      roster,
      scannedIdentifier,
      qrStatus,
    );

    return { ok: true, graded };
  } catch (error) {
    return { ok: false, error: toMessage(error, `Failed to grade ${fileName}.`) };
  }
}
