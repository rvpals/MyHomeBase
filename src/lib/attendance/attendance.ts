import type { AttendanceRepository } from "./ports";
import {
  attendanceReportQuerySchema,
  createClassSchema,
  createStudentSchema,
  enrollStudentsSchema,
  saveAttendanceSchema,
  updateClassSchema,
  updateStudentSchema,
  type AttendanceReportQuery,
  type CreateClassInput,
  type CreateStudentInput,
  type EnrollStudentsInput,
  type SaveAttendanceInput,
  type UpdateClassInput,
  type UpdateStudentInput,
} from "./schema";
import type {
  AttendanceClass,
  AttendanceReport,
  AttendanceSheet,
  Student,
} from "./types";

/** A student's display name. One definition, so every screen agrees. */
export function formatStudentName(student: Student): string {
  return `${student.firstName} ${student.lastName}`.trim();
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export function listStudents(repo: AttendanceRepository): Student[] {
  return repo.listStudents();
}

export function getStudentById(repo: AttendanceRepository, id: number): Student | undefined {
  return repo.getStudentById(id);
}

export function addStudent(repo: AttendanceRepository, input: CreateStudentInput): Student {
  const validated = createStudentSchema.parse(input);
  return repo.createStudent(validated);
}

export function updateStudent(
  repo: AttendanceRepository,
  id: number,
  input: UpdateStudentInput,
): Student {
  const validated = updateStudentSchema.parse(input);
  requireStudent(repo, id);
  return repo.updateStudent(id, validated);
}

export function deleteStudent(repo: AttendanceRepository, id: number): void {
  requireStudent(repo, id);
  repo.deleteStudent(id);
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export function listClasses(repo: AttendanceRepository): AttendanceClass[] {
  return repo.listClasses();
}

export function getClassById(
  repo: AttendanceRepository,
  id: number,
): AttendanceClass | undefined {
  return repo.getClassById(id);
}

/**
 * Creates a class.
 *
 * The name is checked here as well as by the unique index, so a duplicate comes
 * back as a readable message rather than a raw SQLite constraint error.
 */
export function createClass(
  repo: AttendanceRepository,
  input: CreateClassInput,
): AttendanceClass {
  const validated = createClassSchema.parse(input);

  if (repo.getClassByName(validated.name)) {
    throw new Error(`A class named "${validated.name}" already exists.`);
  }

  return repo.createClass(validated);
}

export function updateClass(
  repo: AttendanceRepository,
  id: number,
  input: UpdateClassInput,
): AttendanceClass {
  const validated = updateClassSchema.parse(input);
  requireClass(repo, id);

  // A rename onto another class's name collides; renaming a class to what it
  // is already called is fine.
  const existing = repo.getClassByName(validated.name);
  if (existing && existing.id !== id) {
    throw new Error(`A class named "${validated.name}" already exists.`);
  }

  return repo.updateClass(id, validated);
}

export function deleteClass(repo: AttendanceRepository, id: number): void {
  requireClass(repo, id);
  repo.deleteClass(id);
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

export function listStudentsInClass(repo: AttendanceRepository, classId: number): Student[] {
  requireClass(repo, classId);
  return repo.listStudentsInClass(classId);
}

/**
 * Adds the selected students to a class.
 *
 * Returns how many were actually added — re-adding someone already enrolled is
 * a no-op rather than an error, because selecting a few extra names in a grid
 * and pressing Add is a normal thing to do.
 */
export function enrollStudents(
  repo: AttendanceRepository,
  input: EnrollStudentsInput,
): { addedCount: number; skippedCount: number } {
  const validated = enrollStudentsSchema.parse(input);
  requireClass(repo, validated.classId);

  // Deduplicate before hitting the repository so "skipped" counts students who
  // were already enrolled, not the same id listed twice in one request.
  const uniqueIds = [...new Set(validated.studentIds)];

  for (const studentId of uniqueIds) {
    requireStudent(repo, studentId);
  }

  const addedCount = repo.enrollStudents(validated.classId, uniqueIds);
  return { addedCount, skippedCount: uniqueIds.length - addedCount };
}

export function removeStudentFromClass(
  repo: AttendanceRepository,
  classId: number,
  studentId: number,
): void {
  requireClass(repo, classId);
  repo.removeStudentFromClass(classId, studentId);
}

// ---------------------------------------------------------------------------
// Taking attendance
// ---------------------------------------------------------------------------

/**
 * Everything the home screen needs to take attendance for one class on one date:
 * who is enrolled, and the existing record if there already is one.
 *
 * The caller supplies the date rather than this reading the clock — a use-case
 * that depends on the current time isn't testable without freezing it, and both
 * adapters already know their own "today".
 */
export function getAttendanceSheet(
  repo: AttendanceRepository,
  classId: number,
  attendanceDate: string,
): AttendanceSheet {
  const attendanceClass = requireClass(repo, classId);

  return {
    classId,
    className: attendanceClass.name,
    attendanceDate,
    students: repo.listStudentsInClass(classId),
    existingRecord: repo.getAttendanceRecord(classId, attendanceDate),
  };
}

/**
 * Saves a day's attendance, replacing any record already held for that class
 * and date.
 *
 * Overwrite is the specified behaviour: one attendance record per class per
 * day. The replacement happens inside the repository's transaction, so a failed
 * save can't leave the day with the old record deleted and no new one written.
 *
 * Every entry must name a student actually enrolled in the class. Without that
 * check a stale browser tab could write attendance for someone who has since
 * been removed, and the saved record would disagree with the roster it claims
 * to describe.
 */
export function saveAttendance(repo: AttendanceRepository, input: SaveAttendanceInput) {
  const validated = saveAttendanceSchema.parse(input);
  const attendanceClass = requireClass(repo, validated.classId);

  const enrolled = repo.listStudentsInClass(validated.classId);
  const enrolledById = new Map(enrolled.map((student) => [student.id, student]));

  for (const entry of validated.entries) {
    if (!enrolledById.has(entry.studentId)) {
      throw new Error(`Student ${entry.studentId} is not enrolled in ${attendanceClass.name}.`);
    }
  }

  // One status per student. A payload listing someone twice is a bug in the
  // caller, and silently keeping the last one would hide it.
  const seen = new Set<number>();
  for (const entry of validated.entries) {
    if (seen.has(entry.studentId)) {
      throw new Error(`Student ${entry.studentId} appears more than once.`);
    }
    seen.add(entry.studentId);
  }

  // Names are captured at save time and stored on the record, so a later rename
  // doesn't rewrite a report that has already been printed.
  const studentNames = new Map(
    validated.entries.map((entry) => [
      entry.studentId,
      formatStudentName(enrolledById.get(entry.studentId)!),
    ]),
  );

  return repo.saveAttendance(validated, attendanceClass.name, studentNames);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * The report for one class on one date, or undefined when attendance was never
 * taken that day.
 *
 * "Never taken" is deliberately distinct from "everyone absent" — a teacher
 * needs to be able to tell those apart, which is why a save writes a row for
 * every student rather than only the present ones.
 */
export function getAttendanceReport(
  repo: AttendanceRepository,
  query: AttendanceReportQuery,
): AttendanceReport | undefined {
  const validated = attendanceReportQuerySchema.parse(query);
  const record = repo.getAttendanceRecord(validated.classId, validated.attendanceDate);
  if (!record) return undefined;

  return {
    classId: record.classId,
    className: record.className,
    attendanceDate: record.attendanceDate,
    recordedAt: record.recordedAt,
    presentCount: record.entries.filter((entry) => entry.status === "present").length,
    absentCount: record.entries.filter((entry) => entry.status === "absent").length,
    entries: record.entries,
  };
}

/** The dates a class has attendance for, newest first — the report's picker. */
export function listRecordDatesForClass(repo: AttendanceRepository, classId: number): string[] {
  requireClass(repo, classId);
  return repo.listRecordDatesForClass(classId);
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Rejects an unknown class before reading or writing.
 *
 * Several of the writes below are UPDATEs or INSERTs keyed on `class_id`, so
 * without this a stale id would affect zero rows and report success.
 */
function requireClass(repo: AttendanceRepository, id: number): AttendanceClass {
  const attendanceClass = repo.getClassById(id);
  if (!attendanceClass) throw new Error(`No class with the id ${id}.`);
  return attendanceClass;
}

function requireStudent(repo: AttendanceRepository, id: number): Student {
  const student = repo.getStudentById(id);
  if (!student) throw new Error(`No student with the id ${id}.`);
  return student;
}
