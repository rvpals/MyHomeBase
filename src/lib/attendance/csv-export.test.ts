import { describe, expect, it } from "vitest";
import {
  attendanceDetailReportToCsv,
  attendanceReportCsvFileName,
  attendanceReportToCsv,
} from "./csv-export";
import type { AttendanceDetailReport, AttendanceReport } from "./types";

function action(actionId: number, code: string, name: string) {
  return { actionId, code, name };
}

const brief: AttendanceReport = {
  recordId: 7,
  classId: 1,
  className: "Math 101",
  attendanceDate: "2026-08-15",
  recordedAt: "2026-08-15T09:05:00.000Z",
  sessionLabel: "09:05",
  presentCount: 2,
  absentCount: 1,
  entries: [
    { studentId: 1, studentName: "Ada Lovelace", status: "present", actions: [] },
    {
      studentId: 2,
      studentName: "Grace Hopper",
      status: "present",
      actions: [action(1, "L", "Late"), action(2, "EC", "Extra Credit")],
    },
    { studentId: 3, studentName: "Alan Turing", status: "absent", actions: [] },
  ],
  actionTallies: [],
};

/** Lines without the CRLF, which `toCsv` owns and is tested for elsewhere. */
function lines(csv: string): string[] {
  return csv.split("\r\n");
}

describe("attendanceReportToCsv", () => {
  it("writes a row per student, absentees included", () => {
    expect(lines(attendanceReportToCsv(brief))).toEqual([
      "Class,Date,Session,Student,Status,Actions",
      "Math 101,2026-08-15,09:05,Ada Lovelace,present,",
      "Math 101,2026-08-15,09:05,Grace Hopper,present,L EC",
      "Math 101,2026-08-15,09:05,Alan Turing,absent,",
    ]);
  });

  it("quotes a class name containing a comma", () => {
    const csv = attendanceReportToCsv({ ...brief, className: "Math 101, Section B" });
    expect(lines(csv)[1]).toBe('"Math 101, Section B",2026-08-15,09:05,Ada Lovelace,present,');
  });

  it("returns a header alone when the session has no entries", () => {
    const empty = { ...brief, entries: [], presentCount: 0, absentCount: 0 };
    expect(lines(attendanceReportToCsv(empty))).toEqual([
      "Class,Date,Session,Student,Status,Actions",
    ]);
  });
});

const detail: AttendanceDetailReport = {
  classId: 1,
  className: "Math 101",
  dates: ["2026-08-14", "2026-08-15"],
  rows: [
    {
      studentId: 1,
      studentName: "Ada Lovelace",
      cells: [
        { status: "present", actions: [] },
        { status: "present", actions: [action(1, "L", "Late")] },
      ],
      presentCount: 2,
      absentCount: 0,
    },
    {
      studentId: 2,
      studentName: "Alan Turing",
      // No entry on the first date — enrolled partway through the term.
      cells: [{ actions: [] }, { status: "absent", actions: [] }],
      presentCount: 0,
      absentCount: 1,
    },
  ],
};

describe("attendanceDetailReportToCsv", () => {
  it("writes a column per date and appends codes to the mark", () => {
    expect(lines(attendanceDetailReportToCsv(detail))).toEqual([
      "Student,2026-08-14,2026-08-15,Present,Absent",
      "Ada Lovelace,P,P L,2,0",
      "Alan Turing,,A,0,1",
    ]);
  });

  it("leaves a never-taken cell blank rather than marking it absent", () => {
    const [, , turing] = lines(attendanceDetailReportToCsv(detail));
    // Second field is the 14th, the date Turing has no entry for.
    expect(turing.split(",")[1]).toBe("");
    expect(turing.split(",")[1]).not.toBe("A");
  });

  it("returns a header alone for a class with no attendance yet", () => {
    const empty: AttendanceDetailReport = { ...detail, dates: [], rows: [] };
    expect(lines(attendanceDetailReportToCsv(empty))).toEqual(["Student,Present,Absent"]);
  });
});

describe("attendanceReportCsvFileName", () => {
  it("slugs the class name and appends the date", () => {
    expect(attendanceReportCsvFileName("Math 101", "2026-08-15")).toBe("math-101-2026-08-15");
  });

  it("marks a whole-term grid as all-dates", () => {
    expect(attendanceReportCsvFileName("Math 101")).toBe("math-101-all-dates");
  });

  it("strips characters that would read as a path", () => {
    expect(attendanceReportCsvFileName("Math 101 / Section B", "2026-08-15")).toBe(
      "math-101-section-b-2026-08-15",
    );
  });

  it("falls back when the name slugs away to nothing", () => {
    expect(attendanceReportCsvFileName("///")).toBe("attendance-all-dates");
  });
});
