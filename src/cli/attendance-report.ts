import {
  getAttendanceReport,
  getAttendanceReportById,
  listClasses,
  listSessionsForClass,
} from "@/lib/attendance";
import { todayIsoLocal } from "@/lib/shared/date";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * Prints a class's attendance for a day — the terminal counterpart of the
 * Report screen.
 *
 *   attendance-report --class "Math 101"
 *   attendance-report --class "Math 101" --date 2026-08-15
 *   attendance-report --class "Math 101" --list-sessions
 *   attendance-report --class "Math 101" --session 12
 *
 * Without --session the day's latest register is printed, since a class may be
 * registered more than once a day. `--list-dates` is kept as an alias for
 * --list-sessions.
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

  if ("list-dates" in flags || "list-sessions" in flags) {
    const sessions = listSessionsForClass(deps.attendanceRepo, attendanceClass.id);
    if (sessions.length === 0) {
      console.log(`${attendanceClass.name} has no attendance recorded yet.`);
      return;
    }
    console.log(`${attendanceClass.name} — ${sessions.length} session(s) recorded:`);
    for (const session of sessions) {
      console.log(
        `  #${session.recordId}  ${session.attendanceDate} ${session.sessionLabel}  ` +
          `${session.presentCount} present, ${session.absentCount} absent`,
      );
    }
    return;
  }

  const attendanceDate = flags.date || todayIsoLocal();
  // A specific session when asked for by id, else the day's latest.
  const recordId = Number(flags.session);
  const report = recordId
    ? getAttendanceReportById(deps.attendanceRepo, recordId)
    : getAttendanceReport(deps.attendanceRepo, {
        classId: attendanceClass.id,
        attendanceDate,
      });

  if (!report) {
    console.log(
      recordId
        ? `No session #${recordId}.`
        : `No attendance was taken for ${attendanceClass.name} on ${attendanceDate}.`,
    );
    return;
  }

  console.log(
    `${report.className} — ${report.attendanceDate} session ${report.sessionLabel} ` +
      `(recorded ${report.recordedAt})`,
  );
  console.log(`${report.presentCount} present, ${report.absentCount} absent\n`);

  // Only when something was noted — a line of nothing is worse than no line.
  if (report.actionTallies.length > 0) {
    console.log(
      `Actions: ${report.actionTallies
        .map((tally) => `${tally.code} ${tally.name} x${tally.count}`)
        .join(", ")}`,
    );
    console.log("");
  }

  for (const status of ["present", "absent"] as const) {
    const entries = report.entries.filter((entry) => entry.status === status);
    console.log(`${status.toUpperCase()} (${entries.length}):`);
    for (const entry of entries) {
      const codes = entry.actions.map((action) => action.code);
      console.log(`  ${entry.studentName}${codes.length > 0 ? ` [${codes.join(" ")}]` : ""}`);
    }
    console.log("");
  }
}
