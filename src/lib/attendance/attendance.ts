import type { AttendanceRepository } from "./ports";
import {
  attendanceReportQuerySchema,
  createClassSchema,
  createStudentActionSchema,
  createStudentSchema,
  enrollStudentsSchema,
  saveAttendanceSchema,
  updateClassSchema,
  updateStudentActionSchema,
  updateStudentSchema,
  type AttendanceReportQuery,
  type CreateClassInput,
  type CreateStudentActionInput,
  type CreateStudentInput,
  type EnrollStudentsInput,
  type SaveAttendanceInput,
  type UpdateClassInput,
  type UpdateStudentActionInput,
  type UpdateStudentInput,
} from "./schema";
import type {
  AttendanceActionTally,
  AttendanceClass,
  AttendanceEntry,
  AttendanceRecord,
  AttendanceReport,
  AttendanceSessionSummary,
  AttendanceSheet,
  Student,
  StudentAction,
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
// Student actions (the catalog)
// ---------------------------------------------------------------------------

/**
 * The actions a teacher can pick from.
 *
 * Retired actions are excluded unless asked for: the register's picker wants only
 * what is current, while the management screen has to show a retired one so it
 * can be brought back.
 */
export function listStudentActions(
  repo: AttendanceRepository,
  options: { includeRetired?: boolean } = {},
): StudentAction[] {
  return repo.listStudentActions(options.includeRetired ?? false);
}

export function getStudentActionById(
  repo: AttendanceRepository,
  id: number,
): StudentAction | undefined {
  return repo.getStudentActionById(id);
}

/**
 * Creates an action.
 *
 * The code is checked here as well as by the unique index, so a duplicate reads
 * as a sentence rather than a SQLite constraint error — the same reasoning
 * `createClass` uses for a class name.
 */
export function createStudentAction(
  repo: AttendanceRepository,
  input: CreateStudentActionInput,
): StudentAction {
  const validated = createStudentActionSchema.parse(input);

  const existing = repo.getStudentActionByCode(validated.code);
  if (existing) {
    throw new Error(`The code "${validated.code}" is already used by "${existing.name}".`);
  }

  return repo.createStudentAction(validated);
}

export function updateStudentAction(
  repo: AttendanceRepository,
  id: number,
  input: UpdateStudentActionInput,
): StudentAction {
  const validated = updateStudentActionSchema.parse(input);
  requireStudentAction(repo, id);

  // Re-using an action's own code is fine; taking another action's is not.
  const existing = repo.getStudentActionByCode(validated.code);
  if (existing && existing.id !== id) {
    throw new Error(`The code "${validated.code}" is already used by "${existing.name}".`);
  }

  return repo.updateStudentAction(id, validated);
}

/**
 * Removes an action, or refuses to.
 *
 * An action that has never been recorded is deleted outright — one created by a
 * typo shouldn't linger as a tombstone. Once it has been recorded against a
 * session, deleting is refused with an instruction to retire it instead: the
 * recorded rows carry only the code and the name, so the catalog row is the sole
 * place the icon and description live, and dropping it would leave past sessions
 * half-described.
 *
 * Returns what actually happened, so the caller can say which it was.
 */
export function deleteStudentAction(
  repo: AttendanceRepository,
  id: number,
): { deleted: boolean; recordedUses: number } {
  requireStudentAction(repo, id);

  const recordedUses = repo.countRecordedUsesOfAction(id);
  if (recordedUses > 0) return { deleted: false, recordedUses };

  repo.deleteStudentAction(id);
  return { deleted: true, recordedUses: 0 };
}

/**
 * Retires an action, or brings it back.
 *
 * Separate from `updateStudentAction` so a screen can flip one field without
 * re-posting the whole row — and so "retire" reads as its own intent at the call
 * site rather than as an edit that happens to set a flag.
 */
export function setStudentActionActive(
  repo: AttendanceRepository,
  id: number,
  isActive: boolean,
): StudentAction {
  const action = requireStudentAction(repo, id);

  return repo.updateStudentAction(id, {
    name: action.name,
    code: action.code,
    description: action.description,
    icon: action.icon as never,
    sequence: action.sequence,
    isActive,
  });
}

// ---------------------------------------------------------------------------
// Taking attendance
// ---------------------------------------------------------------------------

/**
 * Everything the home screen needs to take attendance for one class on one date:
 * who is enrolled, and any sessions already saved that day.
 *
 * The sessions are history, not a warning — saving appends a new one rather than
 * replacing them.
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
    sessions: repo.listAttendanceRecords(classId, attendanceDate),
  };
}

/**
 * Saves a session's attendance, **appending** rather than replacing.
 *
 * A class may be registered several times a day (a morning and an afternoon
 * register are two facts, not a correction of one), so each save is its own
 * timestamped session.
 *
 * The caller sends only the students it marked present; everyone else enrolled
 * is written `absent`. That is what lets the screen start with nobody marked
 * while a saved session still accounts for every enrolled student — see
 * `ATTENDANCE_STATUSES`.
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

  // Every action named must exist and still be pickable. A retired one is
  // rejected rather than accepted quietly: a browser tab left open across a
  // retirement would otherwise keep writing an action the teacher has withdrawn.
  //
  // Read once for the whole payload rather than per id — a register of 30 that
  // each named an action would otherwise cost 30 catalog reads.
  const actionsById = new Map(
    repo.listStudentActions(true).map((action) => [action.id, action]),
  );

  for (const entry of validated.entries) {
    // Duplicates within one student's list are a caller bug, and the unique index
    // would reject them mid-transaction with a constraint error rather than a
    // sentence.
    const seenActionIds = new Set<number>();

    for (const actionId of entry.actionIds) {
      const action = actionsById.get(actionId);
      if (!action) throw new Error(`No student action with the id ${actionId}.`);
      if (!action.isActive) {
        throw new Error(`The action "${action.name}" has been retired and can't be recorded.`);
      }
      if (seenActionIds.has(actionId)) {
        throw new Error(
          `The action "${action.name}" is listed twice for student ${entry.studentId}.`,
        );
      }
      seenActionIds.add(actionId);
    }
  }

  // Names are captured at save time and stored on the record, so a later rename
  // doesn't rewrite a report that has already been printed.
  const studentNames = new Map(
    validated.entries.map((entry) => [
      entry.studentId,
      formatStudentName(enrolledById.get(entry.studentId)!),
    ]),
  );

  return repo.saveAttendance(validated, attendanceClass.name, studentNames, actionsById);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * How many students picked up each action in a session.
 *
 * Counted off the entries rather than queried, so the tally can never disagree
 * with the lines printed beneath it. Only actions that actually occurred appear:
 * a row of zeroes for every action the catalog holds is noise on a report, and it
 * would grow every time a teacher added one.
 *
 * First-seen order, which is the entries' order — and the entries carry their
 * actions in catalog order, so the tally reads the same way the chips do.
 */
function tallyActions(entries: AttendanceEntry[]): AttendanceActionTally[] {
  const byActionId = new Map<number, AttendanceActionTally>();

  for (const entry of entries) {
    for (const action of entry.actions) {
      const existing = byActionId.get(action.actionId);
      if (existing) {
        existing.count += 1;
        continue;
      }
      byActionId.set(action.actionId, {
        actionId: action.actionId,
        code: action.code,
        name: action.name,
        count: 1,
      });
    }
  }

  return [...byActionId.values()];
}

/** Rolls a saved session up into its report shape. */
function toReport(record: AttendanceRecord): AttendanceReport {
  return {
    recordId: record.id,
    classId: record.classId,
    className: record.className,
    attendanceDate: record.attendanceDate,
    recordedAt: record.recordedAt,
    sessionLabel: record.sessionLabel,
    presentCount: record.entries.filter((entry) => entry.status === "present").length,
    absentCount: record.entries.filter((entry) => entry.status === "absent").length,
    entries: record.entries,
    actionTallies: tallyActions(record.entries),
  };
}

/**
 * The report for one saved session, or undefined when there is no such session.
 *
 * "Never taken" is deliberately distinct from "everyone absent" — a teacher
 * needs to be able to tell those apart, which is why a save writes a row for
 * every student rather than only the present ones.
 */
export function getAttendanceReportById(
  repo: AttendanceRepository,
  recordId: number,
): AttendanceReport | undefined {
  const record = repo.getAttendanceRecordById(recordId);
  return record ? toReport(record) : undefined;
}

/**
 * The report for a class on a date. With several sessions that day the **latest**
 * is reported, since that's what a teacher printing "today" means; pass a
 * `recordId` to `getAttendanceReportById` to pick a specific one.
 */
export function getAttendanceReport(
  repo: AttendanceRepository,
  query: AttendanceReportQuery,
): AttendanceReport | undefined {
  const validated = attendanceReportQuerySchema.parse(query);
  const [latest] = repo.listAttendanceRecords(validated.classId, validated.attendanceDate);
  return latest ? toReport(latest) : undefined;
}

/** Every session a class has, newest first — the report's picker. */
export function listSessionsForClass(
  repo: AttendanceRepository,
  classId: number,
): AttendanceSessionSummary[] {
  requireClass(repo, classId);
  return repo.listSessionsForClass(classId);
}

/**
 * The distinct dates a class has attendance for, newest first.
 *
 * Derived from the session list rather than queried separately, so a day with
 * two sessions still appears once.
 */
export function listRecordDatesForClass(repo: AttendanceRepository, classId: number): string[] {
  return [...new Set(listSessionsForClass(repo, classId).map((s) => s.attendanceDate))];
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

function requireStudentAction(repo: AttendanceRepository, id: number): StudentAction {
  const action = repo.getStudentActionById(id);
  if (!action) throw new Error(`No student action with the id ${id}.`);
  return action;
}
