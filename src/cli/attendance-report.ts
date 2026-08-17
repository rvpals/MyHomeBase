import { getAttendanceReport, listClasses, listRecordDatesForClass } from "@/lib/attendance";
import { todayIsoLocal } from "@/lib/shared/date";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * Prints a class's attendance for a day — the terminal counterpart of the
 * Report screen.
 *
 *   attendance-report --class "Math 101"
 *   attendance-report --class "Math 101" --date 2026-08-15
 *   attendance-report --class "Math 101" --list-dates
 */
export async function attendanceReportCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const className = flags.class;

  if (!className) {
    console.error('Usage: attendance-report --class "Math 101" [--date YYYY-MM-DD] [--list-dates]');
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

  if ("list-dates" in flags) {
    const dates = listRecordDatesForClass(deps.attendanceRepo, attendanceClass.id);
    if (dates.length === 0) {
      console.log(`${attendanceClass.name} has no attendance recorded yet.`);
      return;
    }
    console.log(`${attendanceClass.name} — ${dates.length} day(s) recorded:`);
    for (const date of dates) console.log(`  ${date}`);
    return;
  }

  const attendanceDate = flags.date || todayIsoLocal();
  const report = getAttendanceReport(deps.attendanceRepo, {
    classId: attendanceClass.id,
    attendanceDate,
  });

  if (!report) {
    console.log(`No attendance was taken for ${attendanceClass.name} on ${attendanceDate}.`);
    return;
  }

  console.log(`${report.className} — ${report.attendanceDate} (recorded ${report.recordedAt})`);
  console.log(`${report.presentCount} present, ${report.absentCount} absent\n`);

  for (const status of ["present", "absent"] as const) {
    const names = report.entries
      .filter((entry) => entry.status === status)
      .map((entry) => entry.studentName);
    console.log(`${status.toUpperCase()} (${names.length}):`);
    for (const name of names) console.log(`  ${name}`);
    console.log("");
  }
}
