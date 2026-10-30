import { describe, expect, it } from "vitest";
import type { AttendanceRepository } from "./ports";
import { buildIndividualStudentRecord } from "./student-record";
import type { AttendanceClass, AttendanceRecord, Student } from "./types";

// A fake built for this use-case rather than the full one in attendance.test.ts,
// which is local to that file. Only the four methods the record reads are real;
// everything else throws, so a read this use-case is not supposed to make fails
// the test loudly instead of quietly returning an empty list.
function fakeRepo(options: {
  students: Student[];
  classes: AttendanceClass[];
  /** classId -> enrolled student ids. */
  enrollments: Map<number, number[]>;
  records: AttendanceRecord[];
}): AttendanceRepository {
  const unused = (name: string) => () => {
    throw new Error(`The student record must not call ${name}.`);
  };

  return new Proxy(
    {
      getStudentById(id: number) {
        return options.students.find((student) => student.id === id);
      },
      listClassesForStudent(studentId: number) {
        return options.classes
          .filter((entry) => (options.enrollments.get(entry.id) ?? []).includes(studentId))
          .sort((a, b) => a.name.localeCompare(b.name));
      },
      listAttendanceRecordsForClass(classId: number) {
        // Oldest first, matching the SQL repository and the main fake.
        return options.records
          .filter((record) => record.classId === classId)
          .sort((a, b) => a.attendanceDate.localeCompare(b.attendanceDate) || a.id - b.id);
      },
    },
    {
      get(target, property: string) {
        return property in target
          ? target[property as keyof typeof target]
          : unused(property);
      },
    },
  ) as unknown as AttendanceRepository;
}

function student(id: number, firstName: string, lastName: string): Student {
  return {
    id,
    firstName,
    lastName,
    studentIdentifier: `S${id}`,
    email: "",
    note: "",
    createdAt: "2026-08-16T09:00:00Z",
    updatedAt: "2026-08-16T09:00:00Z",
  };
}

function attendanceClass(id: number, name: string, classWeekday: number): AttendanceClass {
  return {
    id,
    name,
    description: "",
    classWeekday,
    enrolledCount: 1,
    createdAt: "2026-08-16T09:00:00Z",
    updatedAt: "2026-08-16T09:00:00Z",
  };
}

function record(
  id: number,
  classId: number,
  className: string,
  attendanceDate: string,
  entries: AttendanceRecord["entries"],
): AttendanceRecord {
  return {
    id,
    classId,
    className,
    attendanceDate,
    recordedAt: `${attendanceDate}T14:30:00Z`,
    sessionLabel: "14:30",
    recordedByUserId: 1,
    entries,
  };
}

describe("buildIndividualStudentRecord", () => {
  it("reports every enrolled class, ordered by name, with per-class totals", () => {
    const repo = fakeRepo({
      students: [student(1, "Ada", "Lovelace")],
      // Declared out of alphabetical order, so the sort is actually exercised.
      classes: [attendanceClass(2, "Physics", 3), attendanceClass(1, "Chemistry", 1)],
      enrollments: new Map([
        [1, [1]],
        [2, [1]],
      ]),
      records: [
        record(1, 1, "Chemistry", "2026-09-01", [
          { studentId: 1, studentName: "Ada Lovelace", status: "present", actions: [] },
        ]),
        record(2, 1, "Chemistry", "2026-09-08", [
          { studentId: 1, studentName: "Ada Lovelace", status: "absent", actions: [] },
        ]),
        record(3, 2, "Physics", "2026-09-02", [
          {
            studentId: 1,
            studentName: "Ada Lovelace",
            status: "present",
            actions: [{ actionId: 7, code: "L", name: "Late" }],
          },
        ]),
      ],
    });

    const result = buildIndividualStudentRecord(repo, 1);

    expect(result.student.firstName).toBe("Ada");
    expect(result.classes.map((entry) => entry.className)).toEqual(["Chemistry", "Physics"]);

    const [chemistry, physics] = result.classes;
    expect(chemistry.presentCount).toBe(1);
    expect(chemistry.absentCount).toBe(1);
    expect(chemistry.attendanceRate).toBe(0.5);
    // Newest first within a class.
    expect(chemistry.days.map((day) => day.attendanceDate)).toEqual([
      "2026-09-08",
      "2026-09-01",
    ]);

    expect(physics.days[0].actions).toEqual([{ actionId: 7, code: "L", name: "Late" }]);
    expect(physics.attendanceRate).toBe(1);

    // Totals span every class.
    expect(result.presentCount).toBe(2);
    expect(result.absentCount).toBe(1);
  });

  it("skips a day the class met without this student rather than counting it absent", () => {
    const repo = fakeRepo({
      students: [student(1, "Ada", "Lovelace"), student(2, "Grace", "Hopper")],
      classes: [attendanceClass(1, "Chemistry", 1)],
      enrollments: new Map([[1, [1, 2]]]),
      records: [
        // Ada joined after this one was taken, so she has no entry in it.
        record(1, 1, "Chemistry", "2026-09-01", [
          { studentId: 2, studentName: "Grace Hopper", status: "present", actions: [] },
        ]),
        record(2, 1, "Chemistry", "2026-09-08", [
          { studentId: 1, studentName: "Ada Lovelace", status: "present", actions: [] },
          { studentId: 2, studentName: "Grace Hopper", status: "absent", actions: [] },
        ]),
      ],
    });

    const [chemistry] = buildIndividualStudentRecord(repo, 1).classes;

    expect(chemistry.days).toHaveLength(1);
    expect(chemistry.days[0].attendanceDate).toBe("2026-09-08");
    expect(chemistry.absentCount).toBe(0);
    expect(chemistry.attendanceRate).toBe(1);
  });

  it("leaves the rate undefined for an enrolled class with no registers yet", () => {
    const repo = fakeRepo({
      students: [student(1, "Ada", "Lovelace")],
      classes: [attendanceClass(1, "Chemistry", 1)],
      enrollments: new Map([[1, [1]]]),
      records: [],
    });

    const [chemistry] = buildIndividualStudentRecord(repo, 1).classes;

    expect(chemistry.days).toEqual([]);
    // Undefined, not 0: "attended none" and "none to attend" are different facts.
    expect(chemistry.attendanceRate).toBeUndefined();
  });

  it("returns an empty class list for a student enrolled in nothing", () => {
    const repo = fakeRepo({
      students: [student(1, "Ada", "Lovelace")],
      classes: [attendanceClass(1, "Chemistry", 1)],
      enrollments: new Map([[1, []]]),
      records: [],
    });

    const result = buildIndividualStudentRecord(repo, 1);

    expect(result.classes).toEqual([]);
    expect(result.presentCount).toBe(0);
    expect(result.absentCount).toBe(0);
  });

  it("throws when the id names no student", () => {
    const repo = fakeRepo({
      students: [],
      classes: [],
      enrollments: new Map(),
      records: [],
    });

    expect(() => buildIndividualStudentRecord(repo, 99)).toThrow("No student with the id 99.");
  });
});
