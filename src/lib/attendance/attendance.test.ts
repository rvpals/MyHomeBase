import { describe, expect, it } from "vitest";
import {
  addStudent,
  createClass,
  createStudentAction,
  deleteStudentAction,
  deleteStudents,
  enrollStudents,
  formatStudentName,
  getAttendanceReport,
  getAttendanceReportById,
  getAttendanceSheet,
  getStudentActionById,
  listClasses,
  listRecordDatesForClass,
  listSessionsForClass,
  listStudentActions,
  listStudentsInClass,
  removeStudentFromClass,
  saveAttendance,
  setStudentActionActive,
  updateClass,
  updateStudent,
  updateStudentAction,
} from "./attendance";
import type { AttendanceRepository } from "./ports";
import type {
  ClassWriteData,
  SaveAttendanceData,
  StudentActionWriteData,
  StudentWriteData,
} from "./schema";
import type { AttendanceClass, AttendanceRecord, Student, StudentAction } from "./types";

// Hand-written in-memory fake — no mocking framework, reusable across tests.
function fakeRepo(): AttendanceRepository {
  const students = new Map<number, Student>();
  const classes = new Map<number, AttendanceClass>();
  // classId -> the ids enrolled, insertion-ordered.
  const enrollments = new Map<number, Set<number>>();
  // Every saved session, insertion-ordered. A list rather than a map keyed on
  // class+date, because a class may now be registered several times a day.
  const records: AttendanceRecord[] = [];
  const studentActions = new Map<number, StudentAction>();

  let nextStudentId = 1;
  let nextClassId = 1;
  let nextRecordId = 1;
  let nextActionId = 1;

  const rosterOrder = (a: Student, b: Student) =>
    a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName) || a.id - b.id;

  return {
    listStudents() {
      return [...students.values()].sort(rosterOrder);
    },
    getStudentById(id) {
      return students.get(id);
    },
    createStudent(input: StudentWriteData) {
      const student: Student = {
        id: nextStudentId++,
        ...input,
        createdAt: "2026-08-16T09:00:00Z",
        updatedAt: "2026-08-16T09:00:00Z",
      };
      students.set(student.id, student);
      return student;
    },
    updateStudent(id, input: StudentWriteData) {
      const existing = students.get(id)!;
      const updated = { ...existing, ...input, updatedAt: "2026-08-16T10:00:00Z" };
      students.set(id, updated);
      return updated;
    },
    deleteStudent(id) {
      students.delete(id);
      for (const enrolled of enrollments.values()) enrolled.delete(id);
    },
    deleteStudents(ids) {
      let deleted = 0;
      for (const id of ids) {
        // Counts rows actually removed, matching the real repository: a stale
        // id contributes nothing to the total.
        if (students.delete(id)) deleted++;
        for (const enrolled of enrollments.values()) enrolled.delete(id);
      }
      return deleted;
    },

    listClasses() {
      return [...classes.values()]
        .map((item) => ({ ...item, enrolledCount: enrollments.get(item.id)?.size ?? 0 }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    getClassById(id) {
      const found = classes.get(id);
      return found && { ...found, enrolledCount: enrollments.get(id)?.size ?? 0 };
    },
    getClassByName(name) {
      const found = [...classes.values()].find(
        (item) => item.name.toLowerCase() === name.toLowerCase(),
      );
      return found && { ...found, enrolledCount: enrollments.get(found.id)?.size ?? 0 };
    },
    createClass(input: ClassWriteData) {
      const created: AttendanceClass = {
        id: nextClassId++,
        ...input,
        enrolledCount: 0,
        createdAt: "2026-08-16T09:00:00Z",
        updatedAt: "2026-08-16T09:00:00Z",
      };
      classes.set(created.id, created);
      enrollments.set(created.id, new Set());
      return created;
    },
    updateClass(id, input: ClassWriteData) {
      const existing = classes.get(id)!;
      const updated = { ...existing, ...input, updatedAt: "2026-08-16T10:00:00Z" };
      classes.set(id, updated);
      return { ...updated, enrolledCount: enrollments.get(id)?.size ?? 0 };
    },
    deleteClass(id) {
      classes.delete(id);
      enrollments.delete(id);
    },

    listStudentsInClass(classId) {
      const enrolled = enrollments.get(classId) ?? new Set<number>();
      return [...enrolled]
        .map((studentId) => students.get(studentId))
        .filter((student): student is Student => Boolean(student))
        .sort(rosterOrder);
    },
    enrollStudents(classId, studentIds) {
      const enrolled = enrollments.get(classId) ?? new Set<number>();
      let added = 0;
      for (const studentId of studentIds) {
        if (!enrolled.has(studentId)) {
          enrolled.add(studentId);
          added++;
        }
      }
      enrollments.set(classId, enrolled);
      return added;
    },
    removeStudentFromClass(classId, studentId) {
      enrollments.get(classId)?.delete(studentId);
    },

    listStudentActions(includeRetired) {
      return [...studentActions.values()]
        .filter((action) => includeRetired || action.isActive)
        .sort(
          (a, b) => a.sequence - b.sequence || a.name.localeCompare(b.name) || a.id - b.id,
        );
    },
    getStudentActionById(id) {
      return studentActions.get(id);
    },
    getStudentActionByCode(code) {
      // Case-insensitive, matching the real repository's NOCASE index.
      return [...studentActions.values()].find(
        (action) => action.code.toLowerCase() === code.toLowerCase(),
      );
    },
    createStudentAction(input: StudentActionWriteData) {
      const created: StudentAction = {
        id: nextActionId++,
        ...input,
        createdAt: "2026-08-16T09:00:00Z",
        updatedAt: "2026-08-16T09:00:00Z",
      };
      studentActions.set(created.id, created);
      return created;
    },
    updateStudentAction(id, input: StudentActionWriteData) {
      const existing = studentActions.get(id)!;
      const updated = { ...existing, ...input, updatedAt: "2026-08-16T10:00:00Z" };
      studentActions.set(id, updated);
      return updated;
    },
    countRecordedUsesOfAction(id) {
      return records
        .flatMap((record) => record.entries)
        .flatMap((entry) => entry.actions)
        .filter((action) => action.actionId === id).length;
    },
    deleteStudentAction(id) {
      studentActions.delete(id);
    },

    getAttendanceRecordById(recordId) {
      return records.find((record) => record.id === recordId);
    },
    listAttendanceRecords(classId, attendanceDate) {
      // Newest first, matching the real repository's ORDER BY.
      return records
        .filter(
          (record) => record.classId === classId && record.attendanceDate === attendanceDate,
        )
        .sort((a, b) => b.id - a.id);
    },
    saveAttendance(input: SaveAttendanceData, className, studentNames, actionsById) {
      // A distinct minute per save, so sessionLabel and the newest-first
      // ordering are observable in tests.
      const minute = String(30 + records.length).padStart(2, "0");
      const recordedAt = `2026-08-16T14:${minute}:00Z`;
      const record: AttendanceRecord = {
        id: nextRecordId++,
        classId: input.classId,
        className,
        attendanceDate: input.attendanceDate,
        recordedAt,
        sessionLabel: recordedAt.slice(11, 16),
        recordedByUserId: input.recordedByUserId,
        entries: input.entries.map((entry) => ({
          studentId: entry.studentId,
          studentName: studentNames.get(entry.studentId) ?? `Student ${entry.studentId}`,
          status: entry.status,
          // Code and name captured from the catalog at save time, the way the
          // real repository stores them on the row.
          actions: entry.actionIds.flatMap((actionId) => {
            const action = actionsById.get(actionId);
            return action ? [{ actionId: action.id, code: action.code, name: action.name }] : [];
          }),
        })),
      };
      // Appends. Saving again for the same class and date is a second session,
      // not a replacement — the unique index that used to forbid that is gone
      // (migration 0049).
      records.push(record);
      return record;
    },
    listSessionsForClass(classId) {
      return records
        .filter((record) => record.classId === classId)
        .sort((a, b) => b.attendanceDate.localeCompare(a.attendanceDate) || b.id - a.id)
        .map((record) => ({
          recordId: record.id,
          attendanceDate: record.attendanceDate,
          sessionLabel: record.sessionLabel,
          presentCount: record.entries.filter((e) => e.status === "present").length,
          absentCount: record.entries.filter((e) => e.status === "absent").length,
        }));
    },
    listAttendanceRecordsForClass(classId) {
      // Oldest first, matching the SQL repository — the detail report relies on
      // that order to let the last session of a day win.
      return records
        .filter((record) => record.classId === classId)
        .sort((a, b) => a.attendanceDate.localeCompare(b.attendanceDate) || a.id - b.id);
    },
  };
}

/** The two actions the migration seeds, for the tests that need a catalog. */
function seedActions(repo: AttendanceRepository) {
  const late = createStudentAction(repo, {
    name: "Late",
    code: "L",
    description: "Being late to class.",
    icon: "turtle",
    sequence: 1,
  });
  const extraCredit = createStudentAction(repo, {
    name: "Extra Credit",
    code: "EC",
    icon: "dollar-plus",
    sequence: 2,
  });
  return { late, extraCredit };
}

/** A repo with one class and three students already enrolled. */
function seededRepo() {
  const repo = fakeRepo();
  const mathClass = createClass(repo, { name: "Math 101" });
  const ava = addStudent(repo, { firstName: "Ava", lastName: "Chen" });
  const ben = addStudent(repo, { firstName: "Ben", lastName: "Ortiz" });
  const chi = addStudent(repo, { firstName: "Chi", lastName: "Nguyen" });
  enrollStudents(repo, { classId: mathClass.id, studentIds: [ava.id, ben.id, chi.id] });
  return { repo, mathClass, ava, ben, chi };
}

describe("formatStudentName", () => {
  it("joins the first and last name", () => {
    const repo = fakeRepo();
    const student = addStudent(repo, { firstName: "Ava", lastName: "Chen" });
    expect(formatStudentName(student)).toBe("Ava Chen");
  });
});

describe("addStudent", () => {
  it("creates a student with the optional fields defaulted to blank", () => {
    const repo = fakeRepo();
    const student = addStudent(repo, { firstName: "Ava", lastName: "Chen" });

    expect(student.firstName).toBe("Ava");
    expect(student.studentIdentifier).toBe("");
    expect(student.email).toBe("");
    expect(student.note).toBe("");
  });

  it("keeps the optional fields when supplied", () => {
    const repo = fakeRepo();
    const student = addStudent(repo, {
      firstName: "Ava",
      lastName: "Chen",
      studentIdentifier: "S-1001",
      email: "ava@example.edu",
      note: "Front row",
    });

    expect(student.studentIdentifier).toBe("S-1001");
    expect(student.email).toBe("ava@example.edu");
  });

  it("rejects a blank name", () => {
    const repo = fakeRepo();
    expect(() => addStudent(repo, { firstName: "  ", lastName: "Chen" })).toThrow();
  });

  it("rejects a malformed email but allows a blank one", () => {
    const repo = fakeRepo();
    expect(() =>
      addStudent(repo, { firstName: "Ava", lastName: "Chen", email: "not-an-email" }),
    ).toThrow(/valid email/i);
    expect(() => addStudent(repo, { firstName: "Ben", lastName: "Ortiz", email: "" })).not.toThrow();
  });
});

describe("updateStudent", () => {
  it("rejects an unknown student", () => {
    const repo = fakeRepo();
    expect(() => updateStudent(repo, 99, { firstName: "Ghost", lastName: "User" })).toThrow(
      /No student with the id 99/,
    );
  });
});

describe("deleteStudents", () => {
  it("deletes a whole selection and reports how many went", () => {
    const { repo, ava, ben, chi } = seededRepo();

    expect(deleteStudents(repo, [ava.id, chi.id])).toBe(2);
    expect(repo.listStudents().map((student: Student) => student.id)).toEqual([ben.id]);
  });

  it("clears the deleted students' enrollments", () => {
    const { repo, mathClass, ava, ben, chi } = seededRepo();

    deleteStudents(repo, [ava.id, chi.id]);
    expect(listStudentsInClass(repo, mathClass.id).map((student) => student.id)).toEqual([
      ben.id,
    ]);
  });

  it("counts each student once when an id is listed twice", () => {
    const { repo, ava } = seededRepo();
    expect(deleteStudents(repo, [ava.id, ava.id])).toBe(1);
  });

  /**
   * The reason this isn't a loop over `deleteStudent`, which throws on a missing
   * id: a selection can go stale between rendering the grid and pressing Delete,
   * and that must not cost the rest of the batch.
   */
  it("ignores an id that no longer exists rather than failing the batch", () => {
    const { repo, ava } = seededRepo();

    expect(deleteStudents(repo, [ava.id, 9999])).toBe(1);
    expect(repo.getStudentById(ava.id)).toBeUndefined();
  });

  it("rejects an empty selection", () => {
    expect(() => deleteStudents(fakeRepo(), [])).toThrow(/at least one student/i);
  });

  it("rejects a non-positive id rather than passing it to the database", () => {
    expect(() => deleteStudents(fakeRepo(), [0])).toThrow();
    expect(() => deleteStudents(fakeRepo(), [-3])).toThrow();
  });
});

describe("createClass", () => {
  it("creates a class with no students", () => {
    const repo = fakeRepo();
    const created = createClass(repo, { name: "Math 101", description: "Period 1" });

    expect(created.name).toBe("Math 101");
    expect(created.enrolledCount).toBe(0);
    expect(listClasses(repo)).toHaveLength(1);
  });

  it("rejects a duplicate name, case-insensitively", () => {
    const repo = fakeRepo();
    createClass(repo, { name: "Math 101" });

    expect(() => createClass(repo, { name: "math 101" })).toThrow(/already exists/);
  });

  it("rejects a blank name", () => {
    const repo = fakeRepo();
    expect(() => createClass(repo, { name: "   " })).toThrow();
  });
});

describe("updateClass", () => {
  it("allows a class to keep its own name", () => {
    const repo = fakeRepo();
    const created = createClass(repo, { name: "Math 101" });

    const updated = updateClass(repo, created.id, { name: "Math 101", description: "Period 2" });
    expect(updated.description).toBe("Period 2");
  });

  it("rejects renaming onto another class's name", () => {
    const repo = fakeRepo();
    createClass(repo, { name: "Math 101" });
    const science = createClass(repo, { name: "Science 202" });

    expect(() => updateClass(repo, science.id, { name: "Math 101" })).toThrow(/already exists/);
  });
});

describe("enrollStudents", () => {
  it("adds students to a class", () => {
    const repo = fakeRepo();
    const mathClass = createClass(repo, { name: "Math 101" });
    const ava = addStudent(repo, { firstName: "Ava", lastName: "Chen" });
    const ben = addStudent(repo, { firstName: "Ben", lastName: "Ortiz" });

    const result = enrollStudents(repo, { classId: mathClass.id, studentIds: [ava.id, ben.id] });

    expect(result).toEqual({ addedCount: 2, skippedCount: 0 });
    expect(listStudentsInClass(repo, mathClass.id)).toHaveLength(2);
  });

  it("skips a student already enrolled rather than failing", () => {
    const { repo, mathClass, ava } = seededRepo();
    const dan = addStudent(repo, { firstName: "Dan", lastName: "Ruiz" });

    const result = enrollStudents(repo, { classId: mathClass.id, studentIds: [ava.id, dan.id] });

    expect(result).toEqual({ addedCount: 1, skippedCount: 1 });
    expect(listStudentsInClass(repo, mathClass.id)).toHaveLength(4);
  });

  it("counts a repeated id in one request once", () => {
    const repo = fakeRepo();
    const mathClass = createClass(repo, { name: "Math 101" });
    const ava = addStudent(repo, { firstName: "Ava", lastName: "Chen" });

    const result = enrollStudents(repo, {
      classId: mathClass.id,
      studentIds: [ava.id, ava.id, ava.id],
    });

    expect(result).toEqual({ addedCount: 1, skippedCount: 0 });
  });

  it("lets a student belong to more than one class", () => {
    const { repo, ava } = seededRepo();
    const science = createClass(repo, { name: "Science 202" });

    enrollStudents(repo, { classId: science.id, studentIds: [ava.id] });

    expect(listStudentsInClass(repo, science.id)).toHaveLength(1);
    expect(listClasses(repo).find((item) => item.name === "Math 101")?.enrolledCount).toBe(3);
  });

  it("rejects an unknown class", () => {
    const repo = fakeRepo();
    const ava = addStudent(repo, { firstName: "Ava", lastName: "Chen" });

    expect(() => enrollStudents(repo, { classId: 99, studentIds: [ava.id] })).toThrow(
      /No class with the id 99/,
    );
  });

  it("rejects an unknown student", () => {
    const repo = fakeRepo();
    const mathClass = createClass(repo, { name: "Math 101" });

    expect(() => enrollStudents(repo, { classId: mathClass.id, studentIds: [99] })).toThrow(
      /No student with the id 99/,
    );
  });

  it("rejects an empty selection", () => {
    const repo = fakeRepo();
    const mathClass = createClass(repo, { name: "Math 101" });

    expect(() => enrollStudents(repo, { classId: mathClass.id, studentIds: [] })).toThrow();
  });
});

describe("getAttendanceSheet", () => {
  it("returns the enrolled students and no sessions for a fresh day", () => {
    const { repo, mathClass } = seededRepo();

    const sheet = getAttendanceSheet(repo, mathClass.id, "2026-08-16");

    expect(sheet.className).toBe("Math 101");
    expect(sheet.students).toHaveLength(3);
    expect(sheet.sessions).toEqual([]);
  });

  it("lists the day's sessions once attendance has been taken", () => {
    const { repo, mathClass, ava, ben, chi } = seededRepo();
    saveAttendance(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-16",
      recordedByUserId: 1,
      entries: [
        { studentId: ava.id, status: "present" },
        { studentId: ben.id, status: "absent" },
        { studentId: chi.id, status: "present" },
      ],
    });

    const sheet = getAttendanceSheet(repo, mathClass.id, "2026-08-16");
    expect(sheet.sessions).toHaveLength(1);
    expect(sheet.sessions[0].entries).toHaveLength(3);
  });

  it("lists several sessions newest first", () => {
    const { repo, mathClass, ava, ben, chi } = seededRepo();
    const everyone = [ava, ben, chi];

    for (let index = 0; index < 3; index += 1) {
      saveAttendance(repo, {
        classId: mathClass.id,
        attendanceDate: "2026-08-16",
        recordedByUserId: 1,
        entries: everyone.map((student) => ({
          studentId: student.id,
          status: "present" as const,
        })),
      });
    }

    const sheet = getAttendanceSheet(repo, mathClass.id, "2026-08-16");
    expect(sheet.sessions).toHaveLength(3);
    expect(sheet.sessions[0].id).toBeGreaterThan(sheet.sessions[2].id);
  });

  it("rejects an unknown class", () => {
    const repo = fakeRepo();
    expect(() => getAttendanceSheet(repo, 99, "2026-08-16")).toThrow(/No class with the id 99/);
  });
});

describe("saveAttendance", () => {
  it("saves a status for every student and stamps the class name", () => {
    const { repo, mathClass, ava, ben, chi } = seededRepo();

    const record = saveAttendance(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-16",
      recordedByUserId: 7,
      entries: [
        { studentId: ava.id, status: "present" },
        { studentId: ben.id, status: "absent" },
        { studentId: chi.id, status: "present" },
      ],
    });

    expect(record.className).toBe("Math 101");
    expect(record.recordedByUserId).toBe(7);
    expect(record.entries).toHaveLength(3);
    expect(record.entries.find((entry) => entry.studentId === ava.id)?.studentName).toBe("Ava Chen");
  });

  it("keeps a second save for the same day as its own session", () => {
    const { repo, mathClass, ava, ben, chi } = seededRepo();
    const everyone = [ava, ben, chi];

    const morning = saveAttendance(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-16",
      recordedByUserId: 1,
      entries: everyone.map((student) => ({ studentId: student.id, status: "absent" as const })),
    });

    const afternoon = saveAttendance(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-16",
      recordedByUserId: 1,
      entries: everyone.map((student) => ({ studentId: student.id, status: "present" as const })),
    });

    // Two sessions, and the morning's register survives the afternoon's.
    expect(afternoon.id).not.toBe(morning.id);
    expect(listSessionsForClass(repo, mathClass.id)).toHaveLength(2);
    expect(getAttendanceReportById(repo, morning.id)?.absentCount).toBe(3);
    expect(getAttendanceReportById(repo, afternoon.id)?.presentCount).toBe(3);

    // The date list still shows the day once, not twice.
    expect(listRecordDatesForClass(repo, mathClass.id)).toEqual(["2026-08-16"]);
  });

  it("labels each session with its HH:MM", () => {
    const { repo, mathClass, ava, ben, chi } = seededRepo();
    const everyone = [ava, ben, chi];

    const first = saveAttendance(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-16",
      recordedByUserId: 1,
      entries: everyone.map((student) => ({ studentId: student.id, status: "present" as const })),
    });
    const second = saveAttendance(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-16",
      recordedByUserId: 1,
      entries: everyone.map((student) => ({ studentId: student.id, status: "present" as const })),
    });

    expect(first.sessionLabel).toMatch(/^\d{2}:\d{2}$/);
    expect(second.sessionLabel).not.toBe(first.sessionLabel);
  });

  it("reports the latest session when asked by date alone", () => {
    const { repo, mathClass, ava, ben, chi } = seededRepo();
    const everyone = [ava, ben, chi];

    saveAttendance(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-16",
      recordedByUserId: 1,
      entries: everyone.map((student) => ({ studentId: student.id, status: "absent" as const })),
    });
    saveAttendance(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-16",
      recordedByUserId: 1,
      entries: everyone.map((student) => ({ studentId: student.id, status: "present" as const })),
    });

    // "Print today" means the most recent register, not the first.
    const report = getAttendanceReport(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-16",
    });
    expect(report?.presentCount).toBe(3);
  });

  it("keeps a different date as its own record", () => {
    const { repo, mathClass, ava, ben, chi } = seededRepo();
    const everyone = [ava, ben, chi];

    for (const date of ["2026-08-16", "2026-08-17"]) {
      saveAttendance(repo, {
        classId: mathClass.id,
        attendanceDate: date,
        recordedByUserId: 1,
        entries: everyone.map((student) => ({ studentId: student.id, status: "present" as const })),
      });
    }

    expect(listRecordDatesForClass(repo, mathClass.id)).toEqual(["2026-08-17", "2026-08-16"]);
  });

  it("stores the name as it was, so a later rename doesn't rewrite history", () => {
    const { repo, mathClass, ava, ben, chi } = seededRepo();
    saveAttendance(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-16",
      recordedByUserId: 1,
      entries: [
        { studentId: ava.id, status: "present" },
        { studentId: ben.id, status: "present" },
        { studentId: chi.id, status: "present" },
      ],
    });

    updateStudent(repo, ava.id, { firstName: "Ava-Marie", lastName: "Chen" });
    updateClass(repo, mathClass.id, { name: "Mathematics 101" });

    const report = getAttendanceReport(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-16",
    });
    expect(report?.className).toBe("Math 101");
    expect(report?.entries.find((entry) => entry.studentId === ava.id)?.studentName).toBe(
      "Ava Chen",
    );
  });

  it("rejects a student who isn't enrolled in the class", () => {
    const { repo, mathClass, ava } = seededRepo();
    const outsider = addStudent(repo, { firstName: "Eve", lastName: "Stone" });

    expect(() =>
      saveAttendance(repo, {
        classId: mathClass.id,
        attendanceDate: "2026-08-16",
        recordedByUserId: 1,
        entries: [
          { studentId: ava.id, status: "present" },
          { studentId: outsider.id, status: "present" },
        ],
      }),
    ).toThrow(/not enrolled in Math 101/);
  });

  it("rejects a student who has since been removed from the class", () => {
    const { repo, mathClass, ava, ben } = seededRepo();
    removeStudentFromClass(repo, mathClass.id, ben.id);

    expect(() =>
      saveAttendance(repo, {
        classId: mathClass.id,
        attendanceDate: "2026-08-16",
        recordedByUserId: 1,
        entries: [
          { studentId: ava.id, status: "present" },
          { studentId: ben.id, status: "present" },
        ],
      }),
    ).toThrow(/not enrolled/);
  });

  it("rejects the same student listed twice", () => {
    const { repo, mathClass, ava } = seededRepo();

    expect(() =>
      saveAttendance(repo, {
        classId: mathClass.id,
        attendanceDate: "2026-08-16",
        recordedByUserId: 1,
        entries: [
          { studentId: ava.id, status: "present" },
          { studentId: ava.id, status: "absent" },
        ],
      }),
    ).toThrow(/appears more than once/);
  });

  it("rejects a date that isn't YYYY-MM-DD", () => {
    const { repo, mathClass, ava } = seededRepo();

    expect(() =>
      saveAttendance(repo, {
        classId: mathClass.id,
        attendanceDate: "2026-08-16T09:00:00Z",
        recordedByUserId: 1,
        entries: [{ studentId: ava.id, status: "present" }],
      }),
    ).toThrow(/YYYY-MM-DD/);
  });

  it("rejects an empty class", () => {
    const repo = fakeRepo();
    const emptyClass = createClass(repo, { name: "Empty" });

    expect(() =>
      saveAttendance(repo, {
        classId: emptyClass.id,
        attendanceDate: "2026-08-16",
        recordedByUserId: 1,
        entries: [],
      }),
    ).toThrow();
  });

  it("rejects an unknown class", () => {
    const { repo, ava } = seededRepo();

    expect(() =>
      saveAttendance(repo, {
        classId: 99,
        attendanceDate: "2026-08-16",
        recordedByUserId: 1,
        entries: [{ studentId: ava.id, status: "present" }],
      }),
    ).toThrow(/No class with the id 99/);
  });
});

describe("getAttendanceReport", () => {
  it("counts present and absent separately", () => {
    const { repo, mathClass, ava, ben, chi } = seededRepo();
    saveAttendance(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-16",
      recordedByUserId: 1,
      entries: [
        { studentId: ava.id, status: "present" },
        { studentId: ben.id, status: "absent" },
        { studentId: chi.id, status: "present" },
      ],
    });

    const report = getAttendanceReport(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-16",
    });

    expect(report?.presentCount).toBe(2);
    expect(report?.absentCount).toBe(1);
    expect(report?.entries).toHaveLength(3);
  });

  it("returns undefined when attendance was never taken, which is not the same as everyone absent", () => {
    const { repo, mathClass, ava, ben, chi } = seededRepo();

    expect(
      getAttendanceReport(repo, { classId: mathClass.id, attendanceDate: "2026-08-16" }),
    ).toBeUndefined();

    saveAttendance(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-16",
      recordedByUserId: 1,
      entries: [ava, ben, chi].map((student) => ({
        studentId: student.id,
        status: "absent" as const,
      })),
    });

    const allAbsent = getAttendanceReport(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-16",
    });
    expect(allAbsent).toBeDefined();
    expect(allAbsent?.absentCount).toBe(3);
  });

  it("rejects a malformed date", () => {
    const { repo, mathClass } = seededRepo();

    expect(() =>
      getAttendanceReport(repo, { classId: mathClass.id, attendanceDate: "16/08/2026" }),
    ).toThrow(/YYYY-MM-DD/);
  });
});

describe("createStudentAction", () => {
  it("creates an action, uppercasing the code and defaulting the rest", () => {
    const repo = fakeRepo();
    const action = createStudentAction(repo, { name: "Late", code: " l ", icon: "turtle" });

    expect(action.code).toBe("L");
    expect(action.description).toBe("");
    expect(action.sequence).toBe(0);
    expect(action.isActive).toBe(true);
  });

  it("allows a blank icon — the code alone is a legitimate chip", () => {
    const repo = fakeRepo();
    expect(createStudentAction(repo, { name: "Note", code: "N" }).icon).toBe("");
  });

  it("rejects a blank name and a blank code", () => {
    const repo = fakeRepo();
    expect(() => createStudentAction(repo, { name: "  ", code: "L" })).toThrow();
    expect(() => createStudentAction(repo, { name: "Late", code: " " })).toThrow();
  });

  it("rejects a code longer than a code should be", () => {
    const repo = fakeRepo();
    expect(() => createStudentAction(repo, { name: "Late", code: "VERYLONG" })).toThrow();
  });

  it("rejects an icon that is not in the menu", () => {
    const repo = fakeRepo();
    expect(() =>
      createStudentAction(repo, { name: "Late", code: "L", icon: "rocket" as never }),
    ).toThrow();
  });

  it("rejects a duplicate code, case-insensitively", () => {
    const repo = fakeRepo();
    createStudentAction(repo, { name: "Late", code: "L" });

    expect(() => createStudentAction(repo, { name: "Left early", code: "l" })).toThrow(
      /already used by "Late"/,
    );
  });
});

describe("listStudentActions", () => {
  it("returns the catalog in picker order and hides retired actions by default", () => {
    const repo = fakeRepo();
    const { late } = seedActions(repo);
    setStudentActionActive(repo, late.id, false);

    expect(listStudentActions(repo).map((action) => action.code)).toEqual(["EC"]);
    expect(listStudentActions(repo, { includeRetired: true }).map((a) => a.code)).toEqual([
      "L",
      "EC",
    ]);
  });
});

describe("updateStudentAction", () => {
  it("lets an action keep its own code", () => {
    const repo = fakeRepo();
    const { late } = seedActions(repo);

    const renamed = updateStudentAction(repo, late.id, { name: "Tardy", code: "L" });
    expect(renamed.name).toBe("Tardy");
  });

  it("rejects taking another action's code", () => {
    const repo = fakeRepo();
    const { late } = seedActions(repo);

    expect(() => updateStudentAction(repo, late.id, { name: "Late", code: "EC" })).toThrow(
      /already used by "Extra Credit"/,
    );
  });

  it("rejects an unknown id", () => {
    const repo = fakeRepo();
    expect(() => updateStudentAction(repo, 99, { name: "Late", code: "L" })).toThrow(
      /No student action with the id 99/,
    );
  });
});

describe("setStudentActionActive", () => {
  it("retires an action and brings it back without touching its other fields", () => {
    const repo = fakeRepo();
    const { late } = seedActions(repo);

    const retired = setStudentActionActive(repo, late.id, false);
    expect(retired.isActive).toBe(false);
    expect(retired.icon).toBe("turtle");
    expect(retired.description).toBe("Being late to class.");

    expect(setStudentActionActive(repo, late.id, true).isActive).toBe(true);
  });
});

describe("deleteStudentAction", () => {
  it("deletes an action that has never been recorded", () => {
    const repo = fakeRepo();
    const { late } = seedActions(repo);

    expect(deleteStudentAction(repo, late.id)).toEqual({ deleted: true, recordedUses: 0 });
    expect(listStudentActions(repo).map((action) => action.code)).toEqual(["EC"]);
  });

  it("refuses to delete one that a session has recorded, and leaves it in place", () => {
    const { repo, mathClass, ava } = seededRepo();
    const { late } = seedActions(repo);

    saveAttendance(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-17",
      recordedByUserId: 1,
      entries: [{ studentId: ava.id, status: "present", actionIds: [late.id] }],
    });

    expect(deleteStudentAction(repo, late.id)).toEqual({ deleted: false, recordedUses: 1 });
    expect(getStudentActionById(repo, late.id)?.code).toBe("L");
  });

  it("rejects an unknown id", () => {
    const repo = fakeRepo();
    expect(() => deleteStudentAction(repo, 99)).toThrow(/No student action with the id 99/);
  });
});

describe("saveAttendance with student actions", () => {
  it("records the actions against the student, capturing the code and name", () => {
    const { repo, mathClass, ava, ben } = seededRepo();
    const { late, extraCredit } = seedActions(repo);

    const record = saveAttendance(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-17",
      recordedByUserId: 1,
      entries: [
        { studentId: ava.id, status: "present", actionIds: [late.id, extraCredit.id] },
        { studentId: ben.id, status: "present" },
      ],
    });

    const avaEntry = record.entries.find((entry) => entry.studentId === ava.id)!;
    expect(avaEntry.actions.map((action) => action.code)).toEqual(["L", "EC"]);
    expect(avaEntry.actions[0].name).toBe("Late");

    // Nobody else picked anything up, and the field is an empty list rather than
    // missing, so every screen can map over it without a guard.
    expect(record.entries.find((entry) => entry.studentId === ben.id)!.actions).toEqual([]);
  });

  it("defaults to no actions, so the simplest payload still saves", () => {
    const { repo, mathClass, ava } = seededRepo();

    const record = saveAttendance(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-17",
      recordedByUserId: 1,
      entries: [{ studentId: ava.id, status: "absent" }],
    });

    expect(record.entries[0].actions).toEqual([]);
  });

  it("rejects an unknown action id", () => {
    const { repo, mathClass, ava } = seededRepo();
    seedActions(repo);

    expect(() =>
      saveAttendance(repo, {
        classId: mathClass.id,
        attendanceDate: "2026-08-17",
        recordedByUserId: 1,
        entries: [{ studentId: ava.id, status: "present", actionIds: [99] }],
      }),
    ).toThrow(/No student action with the id 99/);
  });

  it("rejects a retired action, so a stale tab cannot record a withdrawn one", () => {
    const { repo, mathClass, ava } = seededRepo();
    const { late } = seedActions(repo);
    setStudentActionActive(repo, late.id, false);

    expect(() =>
      saveAttendance(repo, {
        classId: mathClass.id,
        attendanceDate: "2026-08-17",
        recordedByUserId: 1,
        entries: [{ studentId: ava.id, status: "present", actionIds: [late.id] }],
      }),
    ).toThrow(/has been retired/);
  });

  it("rejects the same action listed twice for one student", () => {
    const { repo, mathClass, ava } = seededRepo();
    const { late } = seedActions(repo);

    expect(() =>
      saveAttendance(repo, {
        classId: mathClass.id,
        attendanceDate: "2026-08-17",
        recordedByUserId: 1,
        entries: [{ studentId: ava.id, status: "present", actionIds: [late.id, late.id] }],
      }),
    ).toThrow(/listed twice/);
  });

  it("records actions against an absent student, since the two facts are independent", () => {
    const { repo, mathClass, ava } = seededRepo();
    const { late } = seedActions(repo);

    const record = saveAttendance(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-17",
      recordedByUserId: 1,
      entries: [{ studentId: ava.id, status: "absent", actionIds: [late.id] }],
    });

    expect(record.entries[0].status).toBe("absent");
    expect(record.entries[0].actions).toHaveLength(1);
  });
});

describe("getAttendanceReportById action tallies", () => {
  it("counts each action once per student and omits actions nobody got", () => {
    const { repo, mathClass, ava, ben, chi } = seededRepo();
    const { late, extraCredit } = seedActions(repo);

    const record = saveAttendance(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-17",
      recordedByUserId: 1,
      entries: [
        { studentId: ava.id, status: "present", actionIds: [late.id, extraCredit.id] },
        { studentId: ben.id, status: "present", actionIds: [late.id] },
        { studentId: chi.id, status: "absent" },
      ],
    });

    const report = getAttendanceReportById(repo, record.id)!;
    expect(report.actionTallies).toEqual([
      { actionId: late.id, code: "L", name: "Late", count: 2 },
      { actionId: extraCredit.id, code: "EC", name: "Extra Credit", count: 1 },
    ]);
  });

  it("has no tallies when the session recorded no actions", () => {
    const { repo, mathClass, ava } = seededRepo();

    const record = saveAttendance(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-17",
      recordedByUserId: 1,
      entries: [{ studentId: ava.id, status: "present" }],
    });

    expect(getAttendanceReportById(repo, record.id)!.actionTallies).toEqual([]);
  });
});
