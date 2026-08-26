/**
 * Whether a student was there.
 *
 * Two stored states, and no "unmarked": the register **starts with nobody
 * marked**, but that is a screen state rather than a stored one — at save time
 * anyone not marked present is written `absent`. So a saved session still
 * accounts for every enrolled student, and "left blank" and "explicitly absent"
 * are deliberately the same fact.
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

/**
 * One entry in the teacher-editable catalog of things that can be noted about a
 * student on the day — "Late", "Extra Credit".
 *
 * Separate from `AttendanceStatus`, which answers the one question the register
 * exists to answer. An action is orthogonal to it: a student can be present and
 * late, present and earning credit, or present and neither.
 */
export interface StudentAction {
  id: number;
  /** What it is called in the picker. */
  name: string;
  /** The short form a report shows — `L`, `EC`. Unique, case-insensitively. */
  code: string;
  /** Empty when unrecorded. */
  description: string;
  /**
   * A key into `ATTENDANCE_ACTION_ICONS`. Empty, or a key the current set
   * doesn't know, draws nothing — a catalog row can outlive a glyph.
   */
  icon: string;
  /** Order in the picker. Ties break on name. */
  sequence: number;
  /**
   * Whether it appears in the picker. A retired action stays readable in the
   * sessions that already recorded it.
   */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One action as it was recorded against a student in a saved session.
 *
 * `code` and `name` are the values captured at save time, not a live lookup —
 * same reasoning as `studentName` below. `actionId` is kept alongside them so a
 * tally across sessions can count the current catalog row even after a rename.
 */
export interface RecordedStudentAction {
  actionId: number;
  code: string;
  name: string;
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
  /**
   * The actions noted for this student in this session, in catalog order. Empty
   * for most students in most sessions — being late is the exception, not the
   * rule.
   */
  actions: RecordedStudentAction[];
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
  /**
   * `HH:MM`, derived from `recordedAt` when the session was saved.
   *
   * Stored rather than re-derived because a class may be registered several
   * times a day, so this is what distinguishes two sessions in a picker.
   */
  sessionLabel: string;
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
   * Sessions already saved for this class and date, newest first.
   *
   * Saving never replaces one of these — each save is its own session — so this
   * is shown as history rather than as a warning. Empty on a day not yet
   * registered.
   */
  sessions: AttendanceRecord[];
}

/** The roll-up a report shows for one saved session. */
export interface AttendanceReport {
  /** The session this reports on — a date alone no longer identifies one. */
  recordId: number;
  classId: number;
  className: string;
  attendanceDate: string;
  recordedAt: string;
  sessionLabel: string;
  presentCount: number;
  absentCount: number;
  /** Every student's line, present and absent alike, in roster order. */
  entries: AttendanceEntry[];
  /**
   * How many students picked up each action in this session, in catalog order.
   *
   * Derived from `entries` rather than queried, so it can never disagree with the
   * lines printed underneath it. Only actions that actually occurred appear — a
   * tally of zeroes for every action the catalog holds is noise on a report.
   */
  actionTallies: AttendanceActionTally[];
}

/** One action's count within a session. */
export interface AttendanceActionTally {
  actionId: number;
  code: string;
  name: string;
  count: number;
}

/**
 * The two shapes the report screen can render.
 *
 * `brief` is the printable per-session sheet — present/absent name lists for one
 * day. `detail` is the whole-term grid: a row per student, a column per date.
 * A named union rather than a boolean so a third format doesn't have to reshape
 * the URL, and so the value can be validated at the boundary.
 */
export const ATTENDANCE_REPORT_FORMATS = ["brief", "detail"] as const;

export type AttendanceReportFormat = (typeof ATTENDANCE_REPORT_FORMATS)[number];

/**
 * One student's mark on one date in the detail grid.
 *
 * `status` is `undefined` when that student has **no entry** in that date's
 * session — they weren't enrolled yet, or joined later in the term. That is
 * deliberately distinct from `absent`: `AttendanceRecord` writes a row for every
 * enrolled student precisely so "never taken" and "marked absent" stay different
 * facts, and the grid must not collapse them back together.
 */
export interface AttendanceDetailCell {
  status?: AttendanceStatus;
  /** Codes noted that day, in catalog order. Empty for most cells. */
  actions: RecordedStudentAction[];
}

/** One row of the detail grid: a student, and their mark on every date. */
export interface AttendanceDetailRow {
  studentId: number;
  studentName: string;
  /** One cell per date in `AttendanceDetailReport.dates`, same order. */
  cells: AttendanceDetailCell[];
  /** Totals across the row, so a reader can scan a term without counting. */
  presentCount: number;
  absentCount: number;
}

/**
 * The whole-term grid for one class.
 *
 * Columns are **dates**, not sessions: a class registered twice in a day
 * contributes one column carrying its *latest* session, which is the same rule
 * `getAttendanceReport` uses for "today". The brief format is where an individual
 * session is still reachable.
 */
export interface AttendanceDetailReport {
  classId: number;
  className: string;
  /** Every date this class has attendance for, **oldest first** — left to right. */
  dates: string[];
  /**
   * Every student who appears in any session, sorted by name.
   *
   * Built from the sessions rather than from the current roster, so a student who
   * has since been unenrolled still shows the days they attended — the same
   * reasoning that makes `studentName` a stored value rather than a live lookup.
   */
  rows: AttendanceDetailRow[];
}

/** One session in a picker: enough to label it, without its entries. */
export interface AttendanceSessionSummary {
  recordId: number;
  attendanceDate: string;
  sessionLabel: string;
  presentCount: number;
  absentCount: number;
}
