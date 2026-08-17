/**
 * Whether a student was there. Two states by design: everyone starts absent and
 * tapping a name marks them present, so a saved record always accounts for every
 * enrolled student rather than leaving "not marked" ambiguous.
 */
export const ATTENDANCE_STATUSES = ["present", "absent"] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** A student on the roster, independent of any class. */
export interface Student {
  id: number;
  firstName: string;
  lastName: string;
  /** School-assigned ID. Empty when unrecorded. */
  studentIdentifier: string;
  /** Empty when unrecorded. */
  email: string;
  /** Empty when unrecorded. */
  note: string;
  createdAt: string;
  updatedAt: string;
}

/** A class a teacher takes attendance for. */
export interface AttendanceClass {
  id: number;
  name: string;
  /** Empty when unrecorded. */
  description: string;
  /** How many students are enrolled. Derived in SQL, not stored. */
  enrolledCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One student's status within a saved session.
 *
 * `studentName` is the name as it was when attendance was taken, not a live
 * lookup — a report printed last term must keep reading the way it did then.
 */
export interface AttendanceEntry {
  studentId: number;
  studentName: string;
  status: AttendanceStatus;
}

/**
 * One saved attendance session: a class, on a date, with a status for every
 * student enrolled at the time.
 *
 * `className` is denormalized for the same reason as `studentName` above.
 */
export interface AttendanceRecord {
  id: number;
  classId: number;
  className: string;
  /** YYYY-MM-DD. */
  attendanceDate: string;
  /** Full ISO timestamp of the save. */
  recordedAt: string;
  recordedByUserId: number;
  entries: AttendanceEntry[];
}

/**
 * A class's roster prepared for taking attendance: who is enrolled, and how
 * they were last marked if attendance has already been taken for the date.
 */
export interface AttendanceSheet {
  classId: number;
  className: string;
  attendanceDate: string;
  students: Student[];
  /**
   * The existing record for this class and date, when there is one. Its
   * presence is what tells the UI that saving will overwrite rather than
   * create.
   */
  existingRecord?: AttendanceRecord;
}

/** The roll-up a report shows for one class on one date. */
export interface AttendanceReport {
  classId: number;
  className: string;
  attendanceDate: string;
  recordedAt: string;
  presentCount: number;
  absentCount: number;
  /** Every student's line, present and absent alike, in roster order. */
  entries: AttendanceEntry[];
}
