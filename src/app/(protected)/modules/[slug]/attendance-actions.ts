"use server";

// Thin adapters: validate with the module's zod schema (inside the use-case),
// call a lib use-case, revalidate. No business logic here.

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  addStudent,
  attendanceSettingsToEntries,
  createClass,
  createStudentAction,
  deleteClass,
  deleteStudent,
  deleteStudents,
  // Aliased: this file already exports server actions called
  // `deleteStudentAction` / `updateStudentAction`, which act on a *student*. The
  // use-cases below act on a student *action* — an unfortunate collision of two
  // established names, resolved here rather than by renaming either public API.
  deleteStudentAction as deleteStudentActionUseCase,
  enrollStudents,
  removeStudentFromClass,
  saveAttendance,
  setStudentActionActive,
  updateClass,
  updateStudent,
  updateStudentAction as updateStudentActionUseCase,
  type AttendanceSettings,
  type CreateClassInput,
  type CreateStudentActionInput,
  type CreateStudentInput,
  type SaveAttendanceInput,
} from "@/lib/attendance";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { saveModuleSettings } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { deps } from "@/lib/wiring";

const ATTENDANCE_MODULE_PATH = "/modules/attendance";
const ATTENDANCE_MODULE_SLUG = "attendance";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** Every section route, so a write on one screen refreshes the others. */
function revalidateAttendance(): void {
  revalidatePath(ATTENDANCE_MODULE_PATH);
  revalidatePath(`${ATTENDANCE_MODULE_PATH}/rosters`);
  revalidatePath(`${ATTENDANCE_MODULE_PATH}/classes`);
  revalidatePath(`${ATTENDANCE_MODULE_PATH}/actions`);
  revalidatePath(`${ATTENDANCE_MODULE_PATH}/report`);
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export async function addStudentAction(input: CreateStudentInput): Promise<ActionResult> {
  try {
    addStudent(deps.attendanceRepo, input);
    revalidateAttendance();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to add the student.") };
  }
}

export async function updateStudentAction(
  id: number,
  input: CreateStudentInput,
): Promise<ActionResult> {
  try {
    updateStudent(deps.attendanceRepo, id, input);
    revalidateAttendance();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to update the student.") };
  }
}

export async function deleteStudentAction(id: number): Promise<ActionResult> {
  try {
    deleteStudent(deps.attendanceRepo, id);
    revalidateAttendance();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to delete the student.") };
  }
}

export interface BulkActionResult extends ActionResult {
  /** How many rows the write actually touched. */
  count?: number;
}

/**
 * Deletes a ticked selection from the roster.
 *
 * Separate from `deleteStudentAction` rather than looped over it: one write and
 * one revalidate for the whole selection, and one transaction in the repository,
 * so a partial failure can't leave half the selection gone.
 */
export async function deleteStudentsAction(ids: number[]): Promise<BulkActionResult> {
  try {
    const count = deleteStudents(deps.attendanceRepo, ids);
    revalidateAttendance();
    return { ok: true, count };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to delete the students.") };
  }
}

export async function createClassAction(input: CreateClassInput): Promise<ActionResult> {
  try {
    createClass(deps.attendanceRepo, input);
    revalidateAttendance();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to create the class.") };
  }
}

export async function updateClassAction(
  id: number,
  input: CreateClassInput,
): Promise<ActionResult> {
  try {
    updateClass(deps.attendanceRepo, id, input);
    revalidateAttendance();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to update the class.") };
  }
}

export async function deleteClassAction(id: number): Promise<ActionResult> {
  try {
    deleteClass(deps.attendanceRepo, id);
    revalidateAttendance();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to delete the class.") };
  }
}

export interface EnrollResult extends ActionResult {
  addedCount?: number;
  skippedCount?: number;
}

export async function enrollStudentsAction(
  classId: number,
  studentIds: number[],
): Promise<EnrollResult> {
  try {
    const { addedCount, skippedCount } = enrollStudents(deps.attendanceRepo, {
      classId,
      studentIds,
    });
    revalidateAttendance();
    return { ok: true, addedCount, skippedCount };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to add the students to the class.") };
  }
}

export async function removeStudentFromClassAction(
  classId: number,
  studentId: number,
): Promise<ActionResult> {
  try {
    removeStudentFromClass(deps.attendanceRepo, classId, studentId);
    revalidateAttendance();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to remove the student.") };
  }
}

export interface SaveAttendanceResult extends ActionResult {
  /** `HH:MM` of the session just written, so the view can name what it saved. */
  sessionLabel?: string;
}

/**
 * Saves one attendance session, appending rather than replacing — a class may be
 * registered several times a day.
 *
 * `recordedByUserId` comes from the session rather than the client — the browser
 * must not get to name who took the register.
 */
export async function saveAttendanceAction(
  input: Omit<SaveAttendanceInput, "recordedByUserId">,
): Promise<SaveAttendanceResult> {
  try {
    const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
    if (!currentUser) throw new Error("You must be signed in to save attendance.");

    const record = saveAttendance(deps.attendanceRepo, {
      ...input,
      recordedByUserId: currentUser.id,
    });
    revalidateAttendance();
    return { ok: true, sessionLabel: record.sessionLabel };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to save attendance.") };
  }
}

export async function createStudentActionAction(
  input: CreateStudentActionInput,
): Promise<ActionResult> {
  try {
    createStudentAction(deps.attendanceRepo, input);
    revalidateAttendance();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to create the action.") };
  }
}

export async function updateStudentActionAction(
  id: number,
  input: CreateStudentActionInput,
): Promise<ActionResult> {
  try {
    updateStudentActionUseCase(deps.attendanceRepo, id, input);
    revalidateAttendance();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to update the action.") };
  }
}

export async function setStudentActionActiveAction(
  id: number,
  isActive: boolean,
): Promise<ActionResult> {
  try {
    setStudentActionActive(deps.attendanceRepo, id, isActive);
    revalidateAttendance();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to change the action.") };
  }
}

export interface DeleteStudentActionResult extends ActionResult {
  /**
   * How many recorded rows reference the action. Non-zero means it was kept
   * rather than deleted, and the view says so — the use-case refuses to delete an
   * action a session has already recorded.
   */
  recordedUses?: number;
}

export async function deleteStudentActionAction(
  id: number,
): Promise<DeleteStudentActionResult> {
  try {
    const { deleted, recordedUses } = deleteStudentActionUseCase(deps.attendanceRepo, id);
    revalidateAttendance();

    if (!deleted) {
      return {
        ok: false,
        recordedUses,
        error: `This action has been recorded ${recordedUses} time${recordedUses === 1 ? "" : "s"}, so deleting it would leave those sessions half-described. Retire it instead.`,
      };
    }

    return { ok: true, recordedUses };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to delete the action.") };
  }
}

export async function saveAttendanceSettingsAction(
  settings: AttendanceSettings,
): Promise<ActionResult> {
  try {
    const attendanceModule = getModuleBySlug(deps.moduleRepo, ATTENDANCE_MODULE_SLUG);
    if (!attendanceModule) return { ok: false, error: "Attendance module not found." };

    saveModuleSettings(deps.moduleSettingsRepo, {
      moduleId: attendanceModule.id,
      entries: attendanceSettingsToEntries(settings),
    });
    revalidateAttendance();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to save the settings.") };
  }
}
