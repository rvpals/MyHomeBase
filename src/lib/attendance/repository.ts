import type Database from "better-sqlite3";
import type { AttendanceRepository } from "./ports";
import { studentSchema, type ClassWriteData, type SaveAttendanceData, type StudentWriteData } from "./schema";
import type {
  AttendanceClass,
  AttendanceEntry,
  AttendanceRecord,
  AttendanceStatus,
  Student,
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
  recorded_by_user_id: number;
}

interface EntryRow {
  student_id: number;
  student_name: string;
  status: string;
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
    enrolledCount: row.enrolled_count,
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

  // -------------------------------------------------------------------------
  // Classes
  // -------------------------------------------------------------------------

  private selectClasses(where: string): string {
    // enrolledCount is derived rather than stored — a denormalized counter here
    // would have to be kept in step with every enroll and delete for no gain.
    return `
      SELECT c.id, c.name, c.description, c.created_at, c.updated_at,
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
        `INSERT INTO att_classes (name, description) VALUES (@name, @description)`,
      )
      .run(input);

    const created = this.getClassById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back newly created class.");
    return created;
  }

  updateClass(id: number, input: ClassWriteData): AttendanceClass {
    this.db
      .prepare(
        `UPDATE att_classes SET name = @name, description = @description WHERE id = @id`,
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
  // Attendance
  // -------------------------------------------------------------------------

  getAttendanceRecord(classId: number, attendanceDate: string): AttendanceRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, class_id, class_name, attendance_date, recorded_at, recorded_by_user_id
         FROM att_attendance_records
         WHERE class_id = ? AND attendance_date = ?`,
      )
      .get(classId, attendanceDate) as RecordRow | undefined;

    if (!row) return undefined;

    const entryRows = this.db
      .prepare(
        `SELECT student_id, student_name, status
         FROM att_attendance_entries
         WHERE attendance_record_id = ?
         ORDER BY student_name COLLATE NOCASE, student_id`,
      )
      .all(row.id) as EntryRow[];

    const entries: AttendanceEntry[] = entryRows.map((entry) => ({
      studentId: entry.student_id,
      studentName: entry.student_name,
      status: entry.status as AttendanceStatus,
    }));

    return {
      id: row.id,
      classId: row.class_id,
      className: row.class_name,
      attendanceDate: row.attendance_date,
      recordedAt: row.recorded_at,
      recordedByUserId: row.recorded_by_user_id,
      entries,
    };
  }

  saveAttendance(
    input: SaveAttendanceData,
    className: string,
    studentNames: Map<number, string>,
  ): AttendanceRecord {
    const recordedAt = new Date().toISOString();

    // Delete-then-insert in ONE transaction. Re-taking attendance overwrites the
    // day's record, and doing it in two statements outside a transaction could
    // leave the day with the old record gone and no new one written.
    const write = this.db.transaction(() => {
      const existing = this.db
        .prepare(
          "SELECT id FROM att_attendance_records WHERE class_id = ? AND attendance_date = ?",
        )
        .get(input.classId, input.attendanceDate) as { id: number } | undefined;

      if (existing) {
        this.db
          .prepare("DELETE FROM att_attendance_entries WHERE attendance_record_id = ?")
          .run(existing.id);
        this.db.prepare("DELETE FROM att_attendance_records WHERE id = ?").run(existing.id);
      }

      const result = this.db
        .prepare(
          `INSERT INTO att_attendance_records
             (class_id, class_name, attendance_date, recorded_at, recorded_by_user_id)
           VALUES (@classId, @className, @attendanceDate, @recordedAt, @recordedByUserId)`,
        )
        .run({
          classId: input.classId,
          className,
          attendanceDate: input.attendanceDate,
          recordedAt,
          recordedByUserId: input.recordedByUserId,
        });

      const recordId = Number(result.lastInsertRowid);
      const insertEntry = this.db.prepare(
        `INSERT INTO att_attendance_entries
           (attendance_record_id, student_id, student_name, status)
         VALUES (?, ?, ?, ?)`,
      );

      for (const entry of input.entries) {
        insertEntry.run(
          recordId,
          entry.studentId,
          studentNames.get(entry.studentId) ?? `Student ${entry.studentId}`,
          entry.status,
        );
      }
    });

    write();

    const saved = this.getAttendanceRecord(input.classId, input.attendanceDate);
    if (!saved) throw new Error("Failed to read back the saved attendance record.");
    return saved;
  }

  listRecordDatesForClass(classId: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT attendance_date
         FROM att_attendance_records
         WHERE class_id = ?
         ORDER BY attendance_date DESC`,
      )
      .all(classId) as { attendance_date: string }[];
    return rows.map((row) => row.attendance_date);
  }
}
