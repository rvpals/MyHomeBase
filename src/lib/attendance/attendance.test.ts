import { describe, expect, it } from "vitest";
import {
  addStudent,
  createClass,
  enrollStudents,
  formatStudentName,
  getAttendanceReport,
  getAttendanceSheet,
  listClasses,
  listRecordDatesForClass,
  listStudentsInClass,
  removeStudentFromClass,
  saveAttendance,
  updateClass,
  updateStudent,
} from "./attendance";
import type { AttendanceRepository } from "./ports";
import type { ClassWriteData, SaveAttendanceData, StudentWriteData } from "./schema";
import type { AttendanceClass, AttendanceRecord, Student } from "./types";

// Hand-written in-memory fake — no mocking framework, reusable across tests.
function fakeRepo(): AttendanceRepository {
  const students = new Map<number, Student>();
  const classes = new Map<number, AttendanceClass>();
  // classId -> the ids enrolled, insertion-ordered.
  const enrollments = new Map<number, Set<number>>();
  // `${classId}:${date}` -> the saved record.
  const records = new Map<string, AttendanceRecord>();

  let nextStudentId = 1;
  let nextClassId = 1;
  let nextRecordId = 1;

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

    getAttendanceRecord(classId, attendanceDate) {
      return records.get(`${classId}:${attendanceDate}`);
    },
    saveAttendance(input: SaveAttendanceData, className, studentNames) {
      const record: AttendanceRecord = {
        id: nextRecordId++,
        classId: input.classId,
        className,
        attendanceDate: input.attendanceDate,
        recordedAt: "2026-08-16T14:30:00Z",
        recordedByUserId: input.recordedByUserId,
        entries: input.entries.map((entry) => ({
          studentId: entry.studentId,
          studentName: studentNames.get(entry.studentId) ?? `Student ${entry.studentId}`,
          status: entry.status,
        })),
      };
      // Keyed on class+date, so a second save for the same day replaces the
      // first — the same overwrite the unique index enforces for real.
      records.set(`${input.classId}:${input.attendanceDate}`, record);
      return record;
    },
    listRecordDatesForClass(classId) {
      return [...records.values()]
        .filter((record) => record.classId === classId)
        .map((record) => record.attendanceDate)
        .sort((a, b) => b.localeCompare(a));
    },
  };
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
  it("returns the enrolled students and no existing record for a fresh day", () => {
    const { repo, mathClass } = seededRepo();

    const sheet = getAttendanceSheet(repo, mathClass.id, "2026-08-16");

    expect(sheet.className).toBe("Math 101");
    expect(sheet.students).toHaveLength(3);
    expect(sheet.existingRecord).toBeUndefined();
  });

  it("returns the existing record once attendance has been taken", () => {
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
    expect(sheet.existingRecord?.entries).toHaveLength(3);
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

  it("overwrites an earlier save for the same class and date", () => {
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

    const report = getAttendanceReport(repo, {
      classId: mathClass.id,
      attendanceDate: "2026-08-16",
    });
    expect(report?.presentCount).toBe(3);
    expect(report?.absentCount).toBe(0);
    // One record for the day, not two.
    expect(listRecordDatesForClass(repo, mathClass.id)).toEqual(["2026-08-16"]);
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
