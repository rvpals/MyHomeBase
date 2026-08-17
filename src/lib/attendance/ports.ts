import type { ClassWriteData, SaveAttendanceData, StudentWriteData } from "./schema";
import type { AttendanceClass, AttendanceRecord, Student } from "./types";

// The use-cases depend on THIS interface, not on a concrete database.
// That is what lets the web app, the CLI, and tests each supply their own.
export interface AttendanceRepository {
  // Students (the roster)
  listStudents(): Student[];
  getStudentById(id: number): Student | undefined;
  createStudent(input: StudentWriteData): Student;
  updateStudent(id: number, input: StudentWriteData): Student;
  /** Also clears the student's enrollments. Saved records keep their entries. */
  deleteStudent(id: number): void;

  // Classes
  listClasses(): AttendanceClass[];
  getClassById(id: number): AttendanceClass | undefined;
  getClassByName(name: string): AttendanceClass | undefined;
  createClass(input: ClassWriteData): AttendanceClass;
  updateClass(id: number, input: ClassWriteData): AttendanceClass;
  /** Also clears the class's enrollments. Saved records are left intact. */
  deleteClass(id: number): void;

  // Enrollment
  /** The students in a class, in roster order. */
  listStudentsInClass(classId: number): Student[];
  /**
   * Adds each student to the class, skipping any already enrolled. Returns how
   * many rows were actually added, so the caller can report "3 of 5 added".
   */
  enrollStudents(classId: number, studentIds: number[]): number;
  removeStudentFromClass(classId: number, studentId: number): void;

  // Attendance
  getAttendanceRecord(classId: number, attendanceDate: string): AttendanceRecord | undefined;
  /**
   * Writes the session, replacing any existing record for the same class and
   * date. Must be atomic: the delete and the insert are one transaction, or a
   * failed save would leave the day with no attendance at all.
   */
  saveAttendance(input: SaveAttendanceData, className: string, studentNames: Map<number, string>): AttendanceRecord;
  /** Every record for a class, newest first. Used by the report's date picker. */
  listRecordDatesForClass(classId: number): string[];
}
