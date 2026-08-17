"use server";

// Thin adapters: validate with the module's zod schema (inside the use-case),
// call a lib use-case, revalidate. No business logic here.

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  addStudent,
  attendanceSettingsToEntries,
  createClass,
  deleteClass,
  deleteStudent,
  enrollStudents,
  removeStudentFromClass,
  saveAttendance,
  updateClass,
  updateStudent,
  type AttendanceSettings,
  type CreateClassInput,
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

/**
 * Saves a day's attendance.
 *
 * `recordedByUserId` comes from the session rather than the client — the browser
 * must not get to name who took the register.
 */
export async function saveAttendanceAction(
  input: Omit<SaveAttendanceInput, "recordedByUserId">,
): Promise<ActionResult> {
  try {
    const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
    if (!currentUser) throw new Error("You must be signed in to save attendance.");

    saveAttendance(deps.attendanceRepo, { ...input, recordedByUserId: currentUser.id });
    revalidateAttendance();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toMessage(error, "Failed to save attendance.") };
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
