// The Individual Student Record: one student's attendance, class by class.
//
// Its own file rather than another function in attendance.ts because it reads
// across the two halves of that module -- enrollment and saved registers -- and
// belongs to neither. Pure data in, pure data out: the repository is the only
// thing it touches, so the web app and the CLI get the same record.

import type { AttendanceRepository } from "./ports";
import type {
  IndividualStudentRecord,
  StudentAttendanceDay,
  StudentClassRecord,
} from "./types";

/**
 * Everything the record screen shows for one student.
 *
 * Throws when the id names no student -- a caller holding a stale id has asked
 * for a record that cannot exist, and an empty record would read as "enrolled
 * in nothing" rather than "no such student".
 *
 * One class section per **current** enrollment, ordered by class name, each
 * carrying only the days that class's registers actually name this student.
 * A day the class met without them is left out entirely rather than counted
 * absent: `AttendanceRecord` writes a row for every enrolled student precisely
 * so "never on the register" and "marked absent" stay different facts, and
 * collapsing them here would invent absences for a student who joined mid-term.
 */
export function buildIndividualStudentRecord(
  repo: AttendanceRepository,
  studentId: number,
): IndividualStudentRecord {
  const student = repo.getStudentById(studentId);
  if (!student) throw new Error(`No student with the id ${studentId}.`);

  const classes = repo
    .listClassesForStudent(studentId)
    .map((attendanceClass) => {
      // One read per class, each already three queries regardless of how many
      // sessions it holds -- the reason listAttendanceRecordsForClass exists.
      // A student sits in a handful of classes, so this stays a handful of reads.
      const days: StudentAttendanceDay[] = [];

      for (const record of repo.listAttendanceRecordsForClass(attendanceClass.id)) {
        const entry = record.entries.find((candidate) => candidate.studentId === studentId);
        if (!entry) continue;

        days.push({
          attendanceDate: record.attendanceDate,
          sessionLabel: record.sessionLabel,
          status: entry.status,
          actions: entry.actions,
        });
      }

      // Newest first: a teacher opening a student's record is asking about the
      // recent past far more often than about the start of term. The report
      // section's detail grid runs the other way because it is read as a
      // timeline, left to right.
      days.sort((a, b) => b.attendanceDate.localeCompare(a.attendanceDate));

      const presentCount = days.filter((day) => day.status === "present").length;
      const absentCount = days.filter((day) => day.status === "absent").length;

      const classRecord: StudentClassRecord = {
        classId: attendanceClass.id,
        className: attendanceClass.name,
        classWeekday: attendanceClass.classWeekday,
        days,
        presentCount,
        absentCount,
        // Undefined, not 0, with nothing recorded -- see the type's comment.
        attendanceRate: days.length === 0 ? undefined : presentCount / days.length,
      };

      return classRecord;
    });

  return {
    student,
    classes,
    presentCount: classes.reduce((total, entry) => total + entry.presentCount, 0),
    absentCount: classes.reduce((total, entry) => total + entry.absentCount, 0),
  };
}
