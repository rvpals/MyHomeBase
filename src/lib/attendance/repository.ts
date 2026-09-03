import type Database from "better-sqlite3";
import type { AttendanceRepository } from "./ports";
import {
  studentSchema,
  type ClassWriteData,
  type SaveAttendanceData,
  type StudentActionWriteData,
  type StudentWriteData,
} from "./schema";
import type {
  AttendanceClass,
  AttendanceEntry,
  AttendanceRecord,
  AttendanceSessionSummary,
  AttendanceStatus,
  RecordedStudentAction,
  Student,
  StudentAction,
} from "./types";

interface StudentRow {
  id: number;
  first_name: string;
  last_name: string;
  student_identifier: string;
  email: string;
  note: string;
  created_at: string;
  updated_at: string;
}

interface ClassRow {
  id: number;
  name: string;
  description: string;
  class_weekday: number;
  enrolled_count: number;
  created_at: string;
  updated_at: string;
}

interface RecordRow {
  id: number;
  class_id: number;
  class_name: string;
  attendance_date: string;
  recorded_at: string;
  session_label: string;
  recorded_by_user_id: number;
}

interface EntryRow {
  student_id: number;
  student_name: string;
  status: string;
}

interface StudentActionRow {
  id: number;
  name: string;
  code: string;
  description: string;
  icon: string;
  sequence: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

interface EntryActionRow {
  student_id: number;
  action_id: number;
  action_code: string;
  action_name: string;
}

function toStudent(row: StudentRow): Student {
  return studentSchema.parse({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    studentIdentifier: row.student_identifier,
    email: row.email,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function toClass(row: ClassRow): AttendanceClass {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    classWeekday: row.class_weekday,
    enrolledCount: row.enrolled_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStudentAction(row: StudentActionRow): StudentAction {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    icon: row.icon,
    sequence: row.sequence,
    // SQLite has no boolean; the column is 0/1.
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Roster order, used by every list so the same class reads the same way on the
// attendance sheet and on the printed report.
const STUDENT_ORDER = "ORDER BY s.last_name COLLATE NOCASE, s.first_name COLLATE NOCASE, s.id";

const STUDENT_COLUMNS = `
  s.id, s.first_name, s.last_name, s.student_identifier, s.email, s.note,
  s.created_at, s.updated_at
`;

const RECORD_COLUMNS = `
  id, class_id, class_name, attendance_date, recorded_at, session_label,
  recorded_by_user_id
`;

const STUDENT_ACTION_COLUMNS = `
  id, name, code, description, icon, sequence, is_active, created_at, updated_at
`;

// Picker order. Sequence first so a teacher can put Late above Extra Credit,
// name as the tie-break so two actions left at the default 0 are still stable.
const STUDENT_ACTION_ORDER = "ORDER BY sequence, name COLLATE NOCASE, id";

// SQLite caps how many parameters one statement may bind (999 on older builds),
// so a bulk delete over a big selection is issued in chunks.
const ID_CHUNK_SIZE = 500;

function chunkIds(ids: number[]): number[][] {
  const chunks: number[][] = [];
  for (let index = 0; index < ids.length; index += ID_CHUNK_SIZE) {
    chunks.push(ids.slice(index, index + ID_CHUNK_SIZE));
  }
  return chunks;
}

function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}

// The real repository. Swap the database without touching any use-case.
export class SqliteAttendanceRepository implements AttendanceRepository {
  constructor(private db: Database.Database) {}

  // -------------------------------------------------------------------------
  // Students
  // -------------------------------------------------------------------------

  listStudents(): Student[] {
    const rows = this.db
      .prepare(`SELECT ${STUDENT_COLUMNS} FROM att_students s ${STUDENT_ORDER}`)
      .all() as StudentRow[];
    return rows.map(toStudent);
  }

  getStudentById(id: number): Student | undefined {
    const row = this.db
      .prepare(`SELECT ${STUDENT_COLUMNS} FROM att_students s WHERE s.id = ?`)
      .get(id) as StudentRow | undefined;
    return row ? toStudent(row) : undefined;
  }

  createStudent(input: StudentWriteData): Student {
    const result = this.db
      .prepare(
        `INSERT INTO att_students (first_name, last_name, student_identifier, email, note)
         VALUES (@firstName, @lastName, @studentIdentifier, @email, @note)`,
      )
      .run(input);

    const created = this.getStudentById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back newly created student.");
    return created;
  }

  updateStudent(id: number, input: StudentWriteData): Student {
    this.db
      .prepare(
        `UPDATE att_students
         SET first_name = @firstName,
             last_name = @lastName,
             student_identifier = @studentIdentifier,
             email = @email,
             note = @note
         WHERE id = @id`,
      )
      .run({ ...input, id });

    const updated = this.getStudentById(id);
    if (!updated) throw new Error(`Failed to read back updated student ${id}.`);
    return updated;
  }

  deleteStudent(id: number): void {
    // Enrollments go with the student; saved attendance entries deliberately do
    // not, because they carry the name as it was and are a historical record.
    const removeStudent = this.db.transaction((studentId: number) => {
      this.db.prepare("DELETE FROM att_class_enrollments WHERE student_id = ?").run(studentId);
      this.db.prepare("DELETE FROM att_students WHERE id = ?").run(studentId);
    });
    removeStudent(id);
  }

  deleteStudents(ids: number[]): number {
    // One transaction for the whole selection, so a failure part-way through
    // can't leave some students gone and others still enrolled. Chunked because
    // SQLite caps the number of bound parameters in a single statement.
    const removeStudents = this.db.transaction((studentIds: number[]) => {
      let deleted = 0;
      for (const chunk of chunkIds(studentIds)) {
        const marks = placeholders(chunk.length);
        this.db
          .prepare(`DELETE FROM att_class_enrollments WHERE student_id IN (${marks})`)
          .run(chunk);
        // `changes` counts students actually removed, so an id that no longer
        // exists doesn't inflate the total the caller reports.
        deleted += this.db
          .prepare(`DELETE FROM att_students WHERE id IN (${marks})`)
          .run(chunk).changes;
      }
      return deleted;
    });
    return removeStudents(ids);
  }

  // -------------------------------------------------------------------------
  // Classes
  // -------------------------------------------------------------------------

  private selectClasses(where: string): string {
    // enrolledCount is derived rather than stored — a denormalized counter here
    // would have to be kept in step with every enroll and delete for no gain.
    return `
      SELECT c.id, c.name, c.description, c.class_weekday, c.created_at, c.updated_at,
             (SELECT COUNT(*) FROM att_class_enrollments e WHERE e.class_id = c.id) AS enrolled_count
      FROM att_classes c
      ${where}
    `;
  }

  listClasses(): AttendanceClass[] {
    const rows = this.db
      .prepare(this.selectClasses("ORDER BY c.name COLLATE NOCASE"))
      .all() as ClassRow[];
    return rows.map(toClass);
  }

  getClassById(id: number): AttendanceClass | undefined {
    const row = this.db.prepare(this.selectClasses("WHERE c.id = ?")).get(id) as
      | ClassRow
      | undefined;
    return row ? toClass(row) : undefined;
  }

  getClassByName(name: string): AttendanceClass | undefined {
    // NOCASE so "Math 101" and "math 101" are the same class to a teacher, which
    // is also how the unique index behaves for the purposes of this check.
    const row = this.db
      .prepare(this.selectClasses("WHERE c.name = ? COLLATE NOCASE"))
      .get(name) as ClassRow | undefined;
    return row ? toClass(row) : undefined;
  }

  createClass(input: ClassWriteData): AttendanceClass {
    const result = this.db
      .prepare(
        `INSERT INTO att_classes (name, description, class_weekday)
           VALUES (@name, @description, @classWeekday)`,
      )
      .run(input);

    const created = this.getClassById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back newly created class.");
    return created;
  }

  updateClass(id: number, input: ClassWriteData): AttendanceClass {
    this.db
      .prepare(
        `UPDATE att_classes
            SET name = @name, description = @description, class_weekday = @classWeekday
          WHERE id = @id`,
      )
      .run({ ...input, id });

    const updated = this.getClassById(id);
    if (!updated) throw new Error(`Failed to read back updated class ${id}.`);
    return updated;
  }

  deleteClass(id: number): void {
    // Saved attendance records are left alone: they carry the class name as it
    // was, so a deleted class's history stays readable.
    const removeClass = this.db.transaction((classId: number) => {
      this.db.prepare("DELETE FROM att_class_enrollments WHERE class_id = ?").run(classId);
      this.db.prepare("DELETE FROM att_classes WHERE id = ?").run(classId);
    });
    removeClass(id);
  }

  // -------------------------------------------------------------------------
  // Enrollment
  // -------------------------------------------------------------------------

  listStudentsInClass(classId: number): Student[] {
    const rows = this.db
      .prepare(
        `SELECT ${STUDENT_COLUMNS}
         FROM att_students s
         JOIN att_class_enrollments e ON e.student_id = s.id
         WHERE e.class_id = ?
         ${STUDENT_ORDER}`,
      )
      .all(classId) as StudentRow[];
    return rows.map(toStudent);
  }

  enrollStudents(classId: number, studentIds: number[]): number {
    // OR IGNORE leans on the unique (class_id, student_id) index so re-adding an
    // already-enrolled student is a no-op. `changes` then reports how many rows
    // actually landed, which is what the caller shows the teacher.
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO att_class_enrollments (class_id, student_id) VALUES (?, ?)`,
    );

    const enrollAll = this.db.transaction((ids: number[]) => {
      let added = 0;
      for (const studentId of ids) {
        added += insert.run(classId, studentId).changes;
      }
      return added;
    });

    return enrollAll(studentIds);
  }

  removeStudentFromClass(classId: number, studentId: number): void {
    this.db
      .prepare("DELETE FROM att_class_enrollments WHERE class_id = ? AND student_id = ?")
      .run(classId, studentId);
  }

  // -------------------------------------------------------------------------
  // Student actions (the catalog)
  // -------------------------------------------------------------------------

  listStudentActions(includeRetired: boolean): StudentAction[] {
    const rows = this.db
      .prepare(
        `SELECT ${STUDENT_ACTION_COLUMNS}
         FROM att_student_actions
         ${includeRetired ? "" : "WHERE is_active = 1"}
         ${STUDENT_ACTION_ORDER}`,
      )
      .all() as StudentActionRow[];
    return rows.map(toStudentAction);
  }

  getStudentActionById(id: number): StudentAction | undefined {
    const row = this.db
      .prepare(`SELECT ${STUDENT_ACTION_COLUMNS} FROM att_student_actions WHERE id = ?`)
      .get(id) as StudentActionRow | undefined;
    return row ? toStudentAction(row) : undefined;
  }

  getStudentActionByCode(code: string): StudentAction | undefined {
    // NOCASE to match the unique index: `l` and `L` are the same code, so the
    // duplicate check has to agree with what the database will reject.
    const row = this.db
      .prepare(
        `SELECT ${STUDENT_ACTION_COLUMNS} FROM att_student_actions WHERE code = ? COLLATE NOCASE`,
      )
      .get(code) as StudentActionRow | undefined;
    return row ? toStudentAction(row) : undefined;
  }

  createStudentAction(input: StudentActionWriteData): StudentAction {
    const result = this.db
      .prepare(
        `INSERT INTO att_student_actions (name, code, description, icon, sequence, is_active)
         VALUES (@name, @code, @description, @icon, @sequence, @isActive)`,
      )
      .run({ ...input, isActive: input.isActive ? 1 : 0 });

    const created = this.getStudentActionById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back newly created student action.");
    return created;
  }

  updateStudentAction(id: number, input: StudentActionWriteData): StudentAction {
    this.db
      .prepare(
        `UPDATE att_student_actions
         SET name = @name,
             code = @code,
             description = @description,
             icon = @icon,
             sequence = @sequence,
             is_active = @isActive
         WHERE id = @id`,
      )
      .run({ ...input, isActive: input.isActive ? 1 : 0, id });

    const updated = this.getStudentActionById(id);
    if (!updated) throw new Error(`Failed to read back updated student action ${id}.`);
    return updated;
  }

  countRecordedUsesOfAction(id: number): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS used FROM att_attendance_entry_actions WHERE action_id = ?",
      )
      .get(id) as { used: number };
    return row.used;
  }

  deleteStudentAction(id: number): void {
    // Only ever called for an unused action — the use-case checks
    // countRecordedUsesOfAction first and retires a used one instead. Recorded
    // rows are left alone regardless: they carry their own code and name.
    this.db.prepare("DELETE FROM att_student_actions WHERE id = ?").run(id);
  }

  // -------------------------------------------------------------------------
  // Attendance
  // -------------------------------------------------------------------------

  /**
   * Every action recorded in one session, grouped by student.
   *
   * One query for the whole session rather than one per student: a register of 30
   * would otherwise cost 30 reads to answer a question most of them answer with
   * "none".
   *
   * Ordered by the catalog's own sequence via a join, so the chips on a student's
   * line read in the same order as the picker they were chosen from. The join is
   * a LEFT one because a retired-and-then-deleted catalog row must not drop a
   * recorded action off a historical report.
   */
  private loadEntryActions(recordId: number): Map<number, RecordedStudentAction[]> {
    const rows = this.db
      .prepare(
        `SELECT a.student_id, a.action_id, a.action_code, a.action_name
         FROM att_attendance_entry_actions a
         LEFT JOIN att_student_actions c ON c.id = a.action_id
         WHERE a.attendance_record_id = ?
         ORDER BY COALESCE(c.sequence, 0), a.action_name COLLATE NOCASE, a.id`,
      )
      .all(recordId) as EntryActionRow[];

    const byStudentId = new Map<number, RecordedStudentAction[]>();
    for (const row of rows) {
      const actions = byStudentId.get(row.student_id) ?? [];
      actions.push({
        actionId: row.action_id,
        code: row.action_code,
        name: row.action_name,
      });
      byStudentId.set(row.student_id, actions);
    }
    return byStudentId;
  }

  /** Reads one record's entries, in the same order every screen shows them. */
  private loadEntries(recordId: number): AttendanceEntry[] {
    const entryRows = this.db
      .prepare(
        `SELECT student_id, student_name, status
         FROM att_attendance_entries
         WHERE attendance_record_id = ?
         ORDER BY student_name COLLATE NOCASE, student_id`,
      )
      .all(recordId) as EntryRow[];

    const actionsByStudentId = this.loadEntryActions(recordId);

    return entryRows.map((entry) => ({
      studentId: entry.student_id,
      studentName: entry.student_name,
      status: entry.status as AttendanceStatus,
      actions: actionsByStudentId.get(entry.student_id) ?? [],
    }));
  }

  private toRecord(row: RecordRow): AttendanceRecord {
    return {
      id: row.id,
      classId: row.class_id,
      className: row.class_name,
      attendanceDate: row.attendance_date,
      recordedAt: row.recorded_at,
      sessionLabel: row.session_label,
      recordedByUserId: row.recorded_by_user_id,
      entries: this.loadEntries(row.id),
    };
  }

  getAttendanceRecordById(recordId: number): AttendanceRecord | undefined {
    const row = this.db
      .prepare(`SELECT ${RECORD_COLUMNS} FROM att_attendance_records WHERE id = ?`)
      .get(recordId) as RecordRow | undefined;
    return row ? this.toRecord(row) : undefined;
  }

  /**
   * Every session for a class with its entries, oldest first.
   *
   * Three queries total -- records, then all their entries, then all their
   * actions -- rather than `toRecord`'s two-per-record. The detail report reads a
   * whole term at once, where the per-record path would be hundreds of round
   * trips. Grouped in JS afterwards, which is cheap next to the trips saved.
   *
   * Oldest first because that is the order the grid's date columns run in; the
   * per-day pickers want newest first and keep their own ordering.
   */
  listAttendanceRecordsForClass(classId: number): AttendanceRecord[] {
    const recordRows = this.db
      .prepare(
        `SELECT ${RECORD_COLUMNS}
         FROM att_attendance_records
         WHERE class_id = ?
         ORDER BY attendance_date, recorded_at, id`,
      )
      .all(classId) as RecordRow[];
    if (recordRows.length === 0) return [];

    // Same ORDER BY as `loadEntries`, with the record id leading so one pass
    // groups them. Keyed on class_id rather than an id list, so the SQL is a
    // constant string however many sessions there are.
    const entryRows = this.db
      .prepare(
        `SELECT e.attendance_record_id, e.student_id, e.student_name, e.status
         FROM att_attendance_entries e
         JOIN att_attendance_records r ON r.id = e.attendance_record_id
         WHERE r.class_id = ?
         ORDER BY e.attendance_record_id, e.student_name COLLATE NOCASE, e.student_id`,
      )
      .all(classId) as (EntryRow & { attendance_record_id: number })[];

    // LEFT JOIN on the catalog for the same reason `loadEntryActions` uses one:
    // a deleted catalog row must not drop a recorded action off a past report.
    const actionRows = this.db
      .prepare(
        `SELECT a.attendance_record_id, a.student_id, a.action_id, a.action_code, a.action_name
         FROM att_attendance_entry_actions a
         JOIN att_attendance_records r ON r.id = a.attendance_record_id
         LEFT JOIN att_student_actions c ON c.id = a.action_id
         WHERE r.class_id = ?
         ORDER BY a.attendance_record_id, COALESCE(c.sequence, 0),
                  a.action_name COLLATE NOCASE, a.id`,
      )
      .all(classId) as (EntryActionRow & { attendance_record_id: number })[];

    // Keyed by "recordId:studentId" -- an action row is only meaningful against
    // the entry in its own session.
    const actionsByEntry = new Map<string, RecordedStudentAction[]>();
    for (const row of actionRows) {
      const key = `${row.attendance_record_id}:${row.student_id}`;
      const actions = actionsByEntry.get(key) ?? [];
      actions.push({ actionId: row.action_id, code: row.action_code, name: row.action_name });
      actionsByEntry.set(key, actions);
    }

    const entriesByRecord = new Map<number, AttendanceEntry[]>();
    for (const row of entryRows) {
      const entries = entriesByRecord.get(row.attendance_record_id) ?? [];
      entries.push({
        studentId: row.student_id,
        studentName: row.student_name,
        status: row.status as AttendanceStatus,
        actions: actionsByEntry.get(`${row.attendance_record_id}:${row.student_id}`) ?? [],
      });
      entriesByRecord.set(row.attendance_record_id, entries);
    }

    return recordRows.map((row) => ({
      id: row.id,
      classId: row.class_id,
      className: row.class_name,
      attendanceDate: row.attendance_date,
      recordedAt: row.recorded_at,
      sessionLabel: row.session_label,
      recordedByUserId: row.recorded_by_user_id,
      entries: entriesByRecord.get(row.id) ?? [],
    }));
  }

  listAttendanceRecords(classId: number, attendanceDate: string): AttendanceRecord[] {
    const rows = this.db
      .prepare(
        `SELECT ${RECORD_COLUMNS}
         FROM att_attendance_records
         WHERE class_id = ? AND attendance_date = ?
         ORDER BY recorded_at DESC, id DESC`,
      )
      .all(classId, attendanceDate) as RecordRow[];
    return rows.map((row) => this.toRecord(row));
  }

  saveAttendance(
    input: SaveAttendanceData,
    className: string,
    studentNames: Map<number, string>,
    actionsById: Map<number, StudentAction>,
  ): AttendanceRecord {
    const recordedAt = new Date().toISOString();
    // HH:MM out of the ISO timestamp, stored so a picker can label the session
    // without re-parsing. Same slice the 0049 backfill uses.
    const sessionLabel = recordedAt.slice(11, 16);

    // Append, never replace: a class may be registered several times a day, so
    // an afternoon register must not overwrite the morning's. Still one
    // transaction, so a failure can't leave a record with no entries.
    const write = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO att_attendance_records
             (class_id, class_name, attendance_date, recorded_at, session_label, recorded_by_user_id)
           VALUES (@classId, @className, @attendanceDate, @recordedAt, @sessionLabel, @recordedByUserId)`,
        )
        .run({
          classId: input.classId,
          className,
          attendanceDate: input.attendanceDate,
          recordedAt,
          sessionLabel,
          recordedByUserId: input.recordedByUserId,
        });

      const recordId = Number(result.lastInsertRowid);
      const insertEntry = this.db.prepare(
        `INSERT INTO att_attendance_entries
           (attendance_record_id, student_id, student_name, status)
         VALUES (?, ?, ?, ?)`,
      );

      // The action's code and name are captured here, from the catalog rows the
      // use-case resolved — so renaming "Extra Credit" later doesn't rewrite a
      // report that has already been printed.
      const insertEntryAction = this.db.prepare(
        `INSERT INTO att_attendance_entry_actions
           (attendance_record_id, student_id, action_id, action_code, action_name)
         VALUES (?, ?, ?, ?, ?)`,
      );

      for (const entry of input.entries) {
        insertEntry.run(
          recordId,
          entry.studentId,
          studentNames.get(entry.studentId) ?? `Student ${entry.studentId}`,
          entry.status,
        );

        for (const actionId of entry.actionIds) {
          const action = actionsById.get(actionId);
          // The use-case has already rejected an unknown id, so a miss here would
          // be a caller that bypassed it. Skipping beats writing a row whose code
          // is a placeholder no report can explain.
          if (!action) continue;
          insertEntryAction.run(recordId, entry.studentId, action.id, action.code, action.name);
        }
      }

      return recordId;
    });

    const recordId = write();

    const saved = this.getAttendanceRecordById(recordId);
    if (!saved) throw new Error("Failed to read back the saved attendance record.");
    return saved;
  }

  listSessionsForClass(classId: number): AttendanceSessionSummary[] {
    // Counts come from a grouped join rather than N per-record reads — the
    // picker needs a label per session, not their entries.
    const rows = this.db
      .prepare(
        `SELECT r.id,
                r.attendance_date,
                r.session_label,
                COALESCE(SUM(CASE WHEN e.status = 'present' THEN 1 ELSE 0 END), 0) AS present_count,
                COALESCE(SUM(CASE WHEN e.status = 'absent'  THEN 1 ELSE 0 END), 0) AS absent_count
         FROM att_attendance_records r
         LEFT JOIN att_attendance_entries e ON e.attendance_record_id = r.id
         WHERE r.class_id = ?
         GROUP BY r.id
         ORDER BY r.attendance_date DESC, r.recorded_at DESC, r.id DESC`,
      )
      .all(classId) as {
      id: number;
      attendance_date: string;
      session_label: string;
      present_count: number;
      absent_count: number;
    }[];

    return rows.map((row) => ({
      recordId: row.id,
      attendanceDate: row.attendance_date,
      sessionLabel: row.session_label,
      presentCount: row.present_count,
      absentCount: row.absent_count,
    }));
  }
}
