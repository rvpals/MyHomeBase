import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_IMPORT_FIELDS,
  autoMapAttendanceHeaders,
  importAttendanceRoster,
  splitFullName,
} from "./csv-import";
import type { AttendanceRepository } from "./ports";
import type { ClassWriteData, StudentWriteData } from "./schema";
import type { AttendanceClass, Student } from "./types";

/**
 * Hand-written in-memory fake — no mocking framework. Only the roster, class and
 * enrollment methods the import path actually touches are implemented; the rest
 * throw, so a future change that starts calling one fails loudly here rather
 * than passing against a silent stub.
 */
function fakeRepo(): AttendanceRepository {
  const students = new Map<number, Student>();
  const classes = new Map<number, AttendanceClass>();
  const enrollments = new Map<number, Set<number>>();
  let nextStudentId = 1;
  let nextClassId = 1;

  const notImplemented = (name: string) => () => {
    throw new Error(`${name} is not part of the roster import path.`);
  };

  return {
    listStudents() {
      return [...students.values()];
    },
    getStudentById(id) {
      return students.get(id);
    },
    createStudent(input: StudentWriteData) {
      const student: Student = {
        id: nextStudentId++,
        ...input,
        createdAt: "2026-08-23T09:00:00Z",
        updatedAt: "2026-08-23T09:00:00Z",
      };
      students.set(student.id, student);
      return student;
    },
    updateStudent: notImplemented("updateStudent"),
    deleteStudent: notImplemented("deleteStudent"),
    deleteStudents: notImplemented("deleteStudents"),

    listClasses() {
      return [...classes.values()].map((item) => ({
        ...item,
        enrolledCount: enrollments.get(item.id)?.size ?? 0,
      }));
    },
    getClassById(id) {
      const found = classes.get(id);
      return found && { ...found, enrolledCount: enrollments.get(id)?.size ?? 0 };
    },
    getClassByName(name) {
      // Case-insensitive, matching the real repository's unique NOCASE index.
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
        createdAt: "2026-08-23T09:00:00Z",
        updatedAt: "2026-08-23T09:00:00Z",
      };
      classes.set(created.id, created);
      enrollments.set(created.id, new Set());
      return created;
    },
    updateClass: notImplemented("updateClass"),
    deleteClass: notImplemented("deleteClass"),

    listStudentsInClass(classId) {
      const enrolled = enrollments.get(classId) ?? new Set<number>();
      return [...enrolled]
        .map((studentId) => students.get(studentId))
        .filter((student): student is Student => Boolean(student));
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
    removeStudentFromClass: notImplemented("removeStudentFromClass"),

    listStudentActions: notImplemented("listStudentActions"),
    getStudentActionById: notImplemented("getStudentActionById"),
    getStudentActionByCode: notImplemented("getStudentActionByCode"),
    createStudentAction: notImplemented("createStudentAction"),
    updateStudentAction: notImplemented("updateStudentAction"),
    countRecordedUsesOfAction: notImplemented("countRecordedUsesOfAction"),
    deleteStudentAction: notImplemented("deleteStudentAction"),

    getAttendanceRecordById: notImplemented("getAttendanceRecordById"),
    listAttendanceRecords: notImplemented("listAttendanceRecords"),
    saveAttendance: notImplemented("saveAttendance"),
    listSessionsForClass: notImplemented("listSessionsForClass"),
    listAttendanceRecordsForClass: notImplemented("listAttendanceRecordsForClass"),
  };
}

// A verbatim slice of the school export this importer was written for: an `ID` /
// `Name` header, `"Last,First Middle"` cells, and a blank spacer line between
// every student plus two trailing ones.
const SCHOOL_EXPORT_CSV = [
  "ID,Name",
  '891440,"Aboelnour,Amani"',
  ",",
  '876870,"Ayar,Dylan Ilhan"',
  ",",
  '894889,"Miller Sr,Angelina Ashley"',
  ",",
  '900109,"Vargas Quiroz,Angie G"',
  ",",
  ",",
  "",
].join("\n");

const SCHOOL_EXPORT_MAPPING = { "0": "studentIdentifier", "1": "fullName" };

describe("splitFullName", () => {
  it("splits on the first comma into last, first", () => {
    expect(splitFullName("Aboelnour,Amani")).toEqual({
      firstName: "Amani",
      lastName: "Aboelnour",
    });
  });

  it("keeps a multi-word surname whole and folds middle names into the first name", () => {
    expect(splitFullName("Miller Sr,Angelina Ashley")).toEqual({
      firstName: "Angelina Ashley",
      lastName: "Miller Sr",
    });
    expect(splitFullName("Vargas Quiroz,Angie G")).toEqual({
      firstName: "Angie G",
      lastName: "Vargas Quiroz",
    });
  });

  it("trims whitespace around either half", () => {
    expect(splitFullName("  Chen ,  Ava  ")).toEqual({ firstName: "Ava", lastName: "Chen" });
  });

  it("reads a comma-less name as first-then-last", () => {
    expect(splitFullName("Ada Lovelace")).toEqual({ firstName: "Ada", lastName: "Lovelace" });
    expect(splitFullName("Ada Byron Lovelace")).toEqual({
      firstName: "Ada Byron",
      lastName: "Lovelace",
    });
  });

  it("treats a single word as a last name alone", () => {
    expect(splitFullName("Cher")).toEqual({ firstName: "", lastName: "Cher" });
  });

  it("returns both halves blank for an empty cell", () => {
    expect(splitFullName("   ")).toEqual({ firstName: "", lastName: "" });
  });
});

describe("autoMapAttendanceHeaders", () => {
  it("maps the school export's ID and Name headers", () => {
    expect(autoMapAttendanceHeaders(["ID", "Name"]).columnMapping).toEqual(
      SCHOOL_EXPORT_MAPPING,
    );
  });

  it("maps separate first/last spellings, case- and space-insensitively", () => {
    expect(
      autoMapAttendanceHeaders([" First Name ", "SURNAME", "Email Address"]).columnMapping,
    ).toEqual({ "0": "firstName", "1": "lastName", "2": "email" });
  });

  it("leaves unrecognized headers unmapped", () => {
    expect(autoMapAttendanceHeaders(["Name", "Locker Number"]).columnMapping).toEqual({
      "0": "fullName",
    });
  });

  it("only offers fields the import actually understands", () => {
    const known = new Set(ATTENDANCE_IMPORT_FIELDS.map((field) => field.value));
    for (const field of Object.values(autoMapAttendanceHeaders(["ID", "Name"]).columnMapping)) {
      expect(known.has(field as (typeof ATTENDANCE_IMPORT_FIELDS)[number]["value"])).toBe(true);
    }
  });
});

describe("importAttendanceRoster", () => {
  it("imports the school export, splitting names and keeping the student IDs", () => {
    const repo = fakeRepo();
    const result = importAttendanceRoster(repo, SCHOOL_EXPORT_CSV, {
      className: "ACC212 Section 1",
      columnMapping: SCHOOL_EXPORT_MAPPING,
    });

    expect(result.importedCount).toBe(4);
    expect(result.skippedCount).toBe(0);
    expect(repo.listStudents()).toHaveLength(4);

    const amani = repo.listStudents()[0];
    expect(amani.firstName).toBe("Amani");
    expect(amani.lastName).toBe("Aboelnour");
    expect(amani.studentIdentifier).toBe("891440");
    // Unmapped optional fields land blank, not undefined.
    expect(amani.email).toBe("");
    expect(amani.note).toBe("");
  });

  it("ignores blank spacer rows rather than counting them as skips", () => {
    const repo = fakeRepo();
    const result = importAttendanceRoster(repo, SCHOOL_EXPORT_CSV, {
      className: "ACC212 Section 1",
      columnMapping: SCHOOL_EXPORT_MAPPING,
    });

    // The file has 4 students among 10 data records; the other 6 are blank.
    expect(result.results).toHaveLength(4);
    expect(result.results.every((row) => row.status === "imported")).toBe(true);
  });

  it("creates the named class and enrolls everyone imported", () => {
    const repo = fakeRepo();
    const result = importAttendanceRoster(repo, SCHOOL_EXPORT_CSV, {
      className: "ACC212 Section 1",
      columnMapping: SCHOOL_EXPORT_MAPPING,
    });

    expect(result.createdClass).toBe(true);
    expect(result.enrolledCount).toBe(4);
    // Narrowed once: the class is optional on the result type because an import
    // that adds nobody creates none.
    const created = result.attendanceClass;
    expect(created).toBeDefined();
    expect(created?.name).toBe("ACC212 Section 1");
    expect(repo.listStudentsInClass(created!.id)).toHaveLength(4);
    // No weekday: a CSV names a class but says nothing about when it meets, and
    // a guessed Monday would be indistinguishable from a confirmed one. The
    // class simply isn't any day's class until someone sets one.
    expect(created?.classWeekday).toBe(0);
  });

  it("reuses a class that already has that name instead of creating a second one", () => {
    const repo = fakeRepo();
    const existing = repo.createClass({
      name: "ACC212 Section 1",
      description: "Fall term",
      classWeekday: 2,
    });

    const result = importAttendanceRoster(repo, SCHOOL_EXPORT_CSV, {
      className: "acc212 section 1", // different case on purpose
      columnMapping: SCHOOL_EXPORT_MAPPING,
    });

    expect(result.createdClass).toBe(false);
    expect(result.attendanceClass?.id).toBe(existing.id);
    expect(repo.listClasses()).toHaveLength(1);
    // The existing class keeps its description — an import enrolls, it doesn't
    // overwrite the class it lands in.
    expect(result.attendanceClass?.description).toBe("Fall term");
  });

  it("records a row with no usable name as skipped, with a reason, and imports the rest", () => {
    const repo = fakeRepo();
    const csv = ['ID,Name', '1,"Chen,Ava"', '2,"   "', '3,"Ortiz,Ben"'].join("\n");

    const result = importAttendanceRoster(repo, csv, {
      className: "Math 101",
      columnMapping: SCHOOL_EXPORT_MAPPING,
    });

    expect(result.importedCount).toBe(2);
    expect(result.skippedCount).toBe(1);
    const skipped = result.results.find((row) => row.status === "skipped");
    // Row 3: 1-based, counting the header.
    expect(skipped?.rowNumber).toBe(3);
    expect(skipped?.reason).toContain("no name column mapped");
  });

  it("skips a row whose email is present but malformed, keeping the rest", () => {
    const repo = fakeRepo();
    const csv = [
      "Name,Email",
      '"Chen,Ava",ava@example.com',
      '"Ortiz,Ben",not-an-email',
    ].join("\n");

    const result = importAttendanceRoster(repo, csv, {
      className: "Math 101",
      columnMapping: { "0": "fullName", "1": "email" },
    });

    expect(result.importedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(repo.listStudents()[0].email).toBe("ava@example.com");
  });

  it("lets an explicit first/last column win over a full-name column", () => {
    const repo = fakeRepo();
    // Column order puts fullName last on purpose: the explicit halves must win
    // regardless of which column the loop reads first.
    const csv = ["First,Last,Name", 'Ava,Chen,"Wrong,Entirely"'].join("\n");

    importAttendanceRoster(repo, csv, {
      className: "Math 101",
      columnMapping: { "0": "firstName", "1": "lastName", "2": "fullName" },
    });

    const student = repo.listStudents()[0];
    expect(student.firstName).toBe("Ava");
    expect(student.lastName).toBe("Chen");
  });

  it("falls back to the full-name split for whichever half has no explicit column", () => {
    const repo = fakeRepo();
    const csv = ["Name,First", '"Chen,Ignored",Ava'].join("\n");

    importAttendanceRoster(repo, csv, {
      className: "Math 101",
      columnMapping: { "0": "fullName", "1": "firstName" },
    });

    const student = repo.listStudents()[0];
    expect(student.firstName).toBe("Ava");
    expect(student.lastName).toBe("Chen");
  });

  it("applies a column's constant value to every row", () => {
    const repo = fakeRepo();
    const result = importAttendanceRoster(repo, SCHOOL_EXPORT_CSV, {
      className: "ACC212 Section 1",
      columnMapping: { ...SCHOOL_EXPORT_MAPPING, "0": "note" },
      fieldOptions: { "0": { constantValue: "Fall 2026" } },
    });

    expect(result.importedCount).toBe(4);
    expect(repo.listStudents().every((student) => student.note === "Fall 2026")).toBe(true);
  });

  it("rejects a blank class name", () => {
    const repo = fakeRepo();
    expect(() =>
      importAttendanceRoster(repo, SCHOOL_EXPORT_CSV, {
        className: "   ",
        columnMapping: SCHOOL_EXPORT_MAPPING,
      }),
    ).toThrow(/class name is required/i);
  });

  it("imports nothing, and leaves no empty class behind, for a header-only file", () => {
    const repo = fakeRepo();
    const result = importAttendanceRoster(repo, "ID,Name\n,\n,\n", {
      className: "Empty Section",
      columnMapping: SCHOOL_EXPORT_MAPPING,
    });

    expect(result.importedCount).toBe(0);
    expect(result.enrolledCount).toBe(0);
    expect(result.attendanceClass).toBeUndefined();
    expect(repo.listStudents()).toHaveLength(0);
    expect(repo.listClasses()).toHaveLength(0);
  });
});
