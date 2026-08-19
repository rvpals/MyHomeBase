import {
  formatStudentName,
  getAttendanceSheet,
  listClasses,
  listStudentActions,
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
 *   take-attendance --class "Math 101" --present all --actions "3:L,7:L+EC" --user 1
 *
 * `--present` is a comma-separated list of student ids, or `all`. Everyone not
 * listed is recorded absent, which is the same rule the UI applies.
 *
 * `--actions` notes student actions, as `studentId:CODE` pairs separated by
 * commas, with `+` between several codes for one student. Codes are the ones on
 * the Student actions screen (`L`, `EC`), matched case-insensitively — an id would
 * be unusable from a terminal, where the code is the thing a teacher knows.
 *
 * Each run **appends** a session rather than replacing one: a class may be
 * registered several times a day.
 */
export async function takeAttendanceCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const className = flags.class;
  const userId = Number(flags.user);

  if (!className || !userId) {
    console.error(
      'Usage: take-attendance --class "Math 101" --present "3,7" --user 1 [--date YYYY-MM-DD] [--actions "3:L,7:L+EC"]',
    );
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

  // Codes rather than ids, because a code is what a teacher knows and what the
  // report prints. Resolved against the pickable catalog, so a retired action is
  // reported here as unknown rather than rejected later by the use-case with a
  // less helpful message.
  const actionIdByCode = new Map(
    listStudentActions(deps.attendanceRepo).map((action) => [action.code.toUpperCase(), action.id]),
  );

  const actionIdsByStudentId = new Map<number, number[]>();
  const unknownCodes: string[] = [];

  for (const pair of (flags.actions ?? "").split(",")) {
    const [rawStudentId, rawCodes] = pair.split(":");
    const studentId = Number((rawStudentId ?? "").trim());
    if (!Number.isInteger(studentId) || studentId <= 0 || !rawCodes) continue;

    const actionIds: number[] = [];
    for (const rawCode of rawCodes.split("+")) {
      const code = rawCode.trim().toUpperCase();
      if (!code) continue;

      const actionId = actionIdByCode.get(code);
      if (actionId === undefined) {
        unknownCodes.push(code);
        continue;
      }
      // Deduplicate: the same code twice for one student is a typo, and the
      // use-case would reject the whole save over it.
      if (!actionIds.includes(actionId)) actionIds.push(actionId);
    }

    if (actionIds.length > 0) actionIdsByStudentId.set(studentId, actionIds);
  }

  if (unknownCodes.length > 0) {
    console.error(
      `Unknown action code(s): ${[...new Set(unknownCodes)].join(", ")}. Available: ${
        [...actionIdByCode.keys()].join(", ") || "none"
      }.`,
    );
    process.exitCode = 1;
    return;
  }

  const enrolledIds = new Set(sheet.students.map((student) => student.id));
  const strangers = [...actionIdsByStudentId.keys()].filter((id) => !enrolledIds.has(id));
  if (strangers.length > 0) {
    console.error(
      `--actions names student(s) not enrolled in ${attendanceClass.name}: ${strangers.join(", ")}.`,
    );
    process.exitCode = 1;
    return;
  }

  const entries = sheet.students.map((student) => ({
    studentId: student.id,
    status: (presentIds.has(student.id) ? "present" : "absent") as "present" | "absent",
    actionIds: actionIdsByStudentId.get(student.id) ?? [],
  }));

  if (sheet.sessions.length > 0) {
    // Not a warning: this appends a session rather than replacing one.
    console.log(
      `${sheet.sessions.length} session(s) already saved for ${attendanceDate} (${sheet.sessions
        .map((session) => session.sessionLabel)
        .join(", ")}). This adds another.`,
    );
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
      `Saved ${record.className} for ${record.attendanceDate} (session ${record.sessionLabel}): ${presentCount} present, ${record.entries.length - presentCount} absent.`,
    );
    const actionsByStudentId = new Map(
      record.entries.map((entry) => [entry.studentId, entry.actions]),
    );
    for (const student of sheet.students) {
      const status = presentIds.has(student.id) ? "present" : "absent";
      const codes = (actionsByStudentId.get(student.id) ?? []).map((action) => action.code);
      const suffix = codes.length > 0 ? ` [${codes.join(" ")}]` : "";
      console.log(`  #${student.id} ${formatStudentName(student)} — ${status}${suffix}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to save attendance.");
    process.exitCode = 1;
  }
}
