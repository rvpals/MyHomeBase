import type {
  ClassWriteData,
  SaveAttendanceData,
  StudentActionWriteData,
  StudentWriteData,
} from "./schema";
import type { DecodedImage } from "@/lib/shared/image-upload";
import type {
  AttendanceActionIconRef,
  AttendanceClass,
  AttendanceRecord,
  AttendanceSessionSummary,
  Student,
  StudentAction,
} from "./types";

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
  /**
   * Deletes several students in one transaction, returning how many rows were
   * actually removed — an id that no longer exists is simply not counted.
   * Clears their enrollments too, exactly as `deleteStudent` does.
   */
  deleteStudents(ids: number[]): number;

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

  // Student actions (the catalog)
  /**
   * The catalog in picker order. `includeRetired` is for the management screen,
   * which has to show a retired action to un-retire it; every other caller wants
   * only what a teacher can currently pick.
   */
  listStudentActions(includeRetired: boolean): StudentAction[];
  getStudentActionById(id: number): StudentAction | undefined;
  getStudentActionByCode(code: string): StudentAction | undefined;
  createStudentAction(input: StudentActionWriteData): StudentAction;
  updateStudentAction(id: number, input: StudentActionWriteData): StudentAction;
  /** How many recorded rows reference this action, across every session. */
  countRecordedUsesOfAction(id: number): number;
  /**
   * Removes an action that has never been recorded. A used one must be retired
   * instead (`isActive: false`) — the recorded rows carry only its code and name,
   * so deleting the catalog row would leave past sessions half-described.
   */
  deleteStudentAction(id: number): void;
  /**
   * An action's uploaded icon bytes, or undefined when it has none. Its own
   * method rather than a field on `StudentAction` so the blob is read only by
   * the icon-serving route, never by a picker or a register.
   */
  getStudentActionIcon(id: number): AttendanceActionIconRef | undefined;
  /** Stores or, with `undefined`, removes an action's uploaded icon. */
  setStudentActionIcon(id: number, icon: DecodedImage | undefined): void;

  // Attendance
  /** One saved session by its id. */
  getAttendanceRecordById(recordId: number): AttendanceRecord | undefined;
  /**
   * The class's register for a date, or `undefined` when the day was never
   * taken.
   *
   * Singular since migration 0092: a unique index makes (class, date) identify
   * at most one record, so a date *does* identify a register again.
   */
  findAttendanceRecordForDate(
    classId: number,
    attendanceDate: string,
  ): AttendanceRecord | undefined;
  /**
   * Every session for a class on a date, newest first.
   *
   * Returns 0 or 1 rows since migration 0092. Kept as a list for the callers that
   * iterate it; `findAttendanceRecordForDate` is the direct way to ask.
   */
  listAttendanceRecords(classId: number, attendanceDate: string): AttendanceRecord[];
  /**
   * Writes the class's register for the date — **updating** the day's record when
   * one exists, inserting when it doesn't.
   *
   * Re-registering a class corrects the day rather than adding to it, so the
   * existing row keeps its id and its entries are replaced wholesale from the
   * payload. One transaction throughout, so a failure can neither leave a record
   * with no entries nor delete the old entries without writing the new ones.
   */
  saveAttendance(
    input: SaveAttendanceData,
    className: string,
    studentNames: Map<number, string>,
    /**
     * The catalog rows the entries' `actionIds` name, so the write can capture
     * each action's code and name as they are now. Resolved by the use-case,
     * which has already validated that every id exists.
     */
    actionsById: Map<number, StudentAction>,
  ): AttendanceRecord;
  /**
   * Every register a class has, newest first — one per date it was taken.
   * Carries the counts so a date list can label each one without a second read.
   */
  listSessionsForClass(classId: number): AttendanceSessionSummary[];
  /**
   * Every session for a class **with its entries**, oldest first — the detail
   * report's single read.
   *
   * Its own method rather than a loop over `listAttendanceRecords`, which costs
   * two queries per record: across a term that is hundreds of round trips for a
   * grid that wants one pass. This does it in three queries regardless of how
   * many sessions there are.
   */
  listAttendanceRecordsForClass(classId: number): AttendanceRecord[];
}
