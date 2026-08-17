import {
  formatStudentName,
  getAttendanceSheet,
  listClasses,
  saveAttendance,
} from "@/lib/attendance";
import { todayIsoLocal } from "@/lib/shared/date";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * Records attendance for a class from the terminal — the same use-case the web
 * app's home screen calls.
 *
 *   take-attendance --class "Math 101" --present "3,7,9" --user 1
 *   take-attendance --class "Math 101" --present all --user 1
 *   take-attendance --class "Math 101" --date 2026-08-15 --present "3" --user 1
 *
 * `--present` is a comma-separated list of student ids, or `all`. Everyone not
 * listed is recorded absent, which is the same rule the UI applies. Saving for
 * a class and date that already has attendance replaces that record.
 */
export async function takeAttendanceCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const className = flags.class;
  const userId = Number(flags.user);

  if (!className || !userId) {
    console.error('Usage: take-attendance --class "Math 101" --present "3,7" --user 1 [--date YYYY-MM-DD]');
    process.exitCode = 1;
    return;
  }

  const attendanceClass = listClasses(deps.attendanceRepo).find(
    (item) => item.name.toLowerCase() === className.toLowerCase(),
  );

  if (!attendanceClass) {
    console.error(`No class named "${className}".`);
    process.exitCode = 1;
    return;
  }

  const attendanceDate = flags.date || todayIsoLocal();
  const sheet = getAttendanceSheet(deps.attendanceRepo, attendanceClass.id, attendanceDate);

  if (sheet.students.length === 0) {
    console.error(`${attendanceClass.name} has no students enrolled.`);
    process.exitCode = 1;
    return;
  }

  const presentFlag = (flags.present ?? "").trim();
  const presentIds =
    presentFlag.toLowerCase() === "all"
      ? new Set(sheet.students.map((student) => student.id))
      : new Set(
          presentFlag
            .split(",")
            .map((part) => Number(part.trim()))
            .filter((id) => Number.isInteger(id) && id > 0),
        );

  const entries = sheet.students.map((student) => ({
    studentId: student.id,
    status: (presentIds.has(student.id) ? "present" : "absent") as "present" | "absent",
  }));

  if (sheet.existingRecord) {
    console.log(`Replacing the existing record for ${attendanceDate}.`);
  }

  try {
    const record = saveAttendance(deps.attendanceRepo, {
      classId: attendanceClass.id,
      attendanceDate,
      recordedByUserId: userId,
      entries,
    });

    const presentCount = record.entries.filter((entry) => entry.status === "present").length;
    console.log(
      `Saved ${record.className} for ${record.attendanceDate}: ${presentCount} present, ${record.entries.length - presentCount} absent.`,
    );
    for (const student of sheet.students) {
      const status = presentIds.has(student.id) ? "present" : "absent";
      console.log(`  #${student.id} ${formatStudentName(student)} — ${status}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to save attendance.");
    process.exitCode = 1;
  }
}
