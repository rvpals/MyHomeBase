// Turning a finished report into CSV, for a teacher who has to send the office a
// file rather than a printed sheet.
//
// Pure derivation over a report that has already been built: these take the same
// AttendanceReport / AttendanceDetailReport the Report screen renders and return
// text. The CSV mechanics themselves (quoting, CRLF) are not re-implemented here
// — `toCsv` in @/lib/shared/table already owns them, and DataGrid's own export
// goes through the same pair.

import { toCsv, type CellValue } from "@/lib/shared/table";
import type { AttendanceDetailReport, AttendanceEntry, AttendanceReport } from "./types";

/** What a present student's cell reads in the detail grid. */
const PRESENT_MARK = "P";

/** What an absent student's cell reads. */
const ABSENT_MARK = "A";

/**
 * The codes noted for one entry, space-separated — `"L EC"`, or `""`.
 *
 * Space rather than comma even though a CSV field can hold a comma: a reader
 * opening this in a spreadsheet sees one column of codes, and a comma invites
 * whatever imports it next to split the field back apart.
 */
function codesOf(entry: Pick<AttendanceEntry, "actions">): string {
  return entry.actions.map((action) => action.code).join(" ");
}

/**
 * One session as a row per student.
 *
 * Absent students are included, in the same roster order the brief sheet prints
 * them: the report exists to show both lists, and dropping the absentees would
 * make the file say something the screen doesn't. The class, date and session
 * repeat on every row so the file survives being concatenated with another one.
 */
export function attendanceReportToCsv(report: AttendanceReport): string {
  const header = ["Class", "Date", "Session", "Student", "Status", "Actions"];

  const rows: CellValue[][] = report.entries.map((entry) => [
    report.className,
    report.attendanceDate,
    report.sessionLabel,
    entry.studentName,
    entry.status,
    codesOf(entry),
  ]);

  return toCsv(header, rows);
}

/**
 * The whole-term grid: a row per student, a column per date.
 *
 * A cell is `P` or `A`, with any codes appended — `"P L"` for present and late.
 * A student with **no entry** on a date gets a blank cell, not an `A`: that
 * distinction is the whole reason `AttendanceDetailCell.status` is optional, and
 * collapsing it here would quietly turn "wasn't enrolled yet" into "missed the
 * class" for anyone who totalled the column.
 *
 * The two trailing totals are the ones the grid already shows, carried over so a
 * reader doesn't have to recount what the screen had worked out.
 */
export function attendanceDetailReportToCsv(report: AttendanceDetailReport): string {
  const header = ["Student", ...report.dates, "Present", "Absent"];

  const rows: CellValue[][] = report.rows.map((row) => [
    row.studentName,
    ...row.cells.map((cell) => {
      if (!cell.status) return "";
      const mark = cell.status === "present" ? PRESENT_MARK : ABSENT_MARK;
      const codes = codesOf(cell);
      return codes ? `${mark} ${codes}` : mark;
    }),
    row.presentCount,
    row.absentCount,
  ]);

  return toCsv(header, rows);
}

/** Everything a file name must not contain, on any of the platforms this runs on. */
const UNSAFE_FILE_NAME = /[^a-z0-9]+/gi;

/**
 * The download name, shared by the web button and the CLI's `--csv` so the same
 * report doesn't arrive under two different names depending on where it was run.
 *
 * The class name is slugged rather than trusted: it is free text a teacher typed,
 * and a slash in it would otherwise read as a path separator. The `.csv`
 * extension is *not* included — the web caller appends it, matching DataGrid's
 * `exportFileName` convention.
 */
export function attendanceReportCsvFileName(
  className: string,
  /** The date for a brief sheet; omitted for a whole-term grid. */
  attendanceDate?: string,
): string {
  const slug = className.replace(UNSAFE_FILE_NAME, "-").replace(/^-|-$/g, "").toLowerCase();
  const base = slug || "attendance";
  return attendanceDate ? `${base}-${attendanceDate}` : `${base}-all-dates`;
}
