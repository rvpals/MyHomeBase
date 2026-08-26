// Attendance-specific CSV import: turns a mapped CSV record into a roster entry,
// and enrolls the imported students into a class named by the caller. The generic
// mapping machinery (parsing, applyMapping, per-column options) lives in
// @/lib/csv-import; this adapter knows what each roster field means.
import { applyMapping, parseCsvRecords, summarizeImportResults } from "@/lib/csv-import";
import type {
  ColumnMapping,
  FieldOptions,
  FieldOptionsMap,
  ImportRowResult,
  ImportSummary,
} from "@/lib/csv-import";
import { addStudent, enrollStudents } from "./attendance";
import type { AttendanceRepository } from "./ports";
import { importRosterSchema, type ImportRosterInput } from "./schema";
import type { AttendanceClass, Student } from "./types";

/**
 * The roster fields a CSV column can be mapped to, for the mapping UI.
 *
 * `fullName` exists because school exports ship one `Name` column holding
 * `"Last,First Middle"` rather than two columns. In practice it is mutually
 * exclusive with the separate first/last fields, but nothing enforces that: if
 * both are mapped, the explicit halves win (see `recordToStudentInput`), because
 * a column that says exactly what it holds is better evidence than one that has
 * to be split.
 */
export const ATTENDANCE_IMPORT_FIELDS = [
  { value: "fullName", label: "Full name (Last,First)" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "studentIdentifier", label: "Student ID" },
  { value: "email", label: "Email" },
  { value: "note", label: "Note" },
] as const;

/**
 * Splits a `"Last,First Middle"` cell into its two halves.
 *
 * **Only the first comma separates.** Everything before it is the surname,
 * everything after is the given name(s) — which is what makes
 * `"Miller Sr,Angelina Ashley"` and `"Vargas Quiroz,Angie G"` come out right:
 * multi-word surnames survive, and trailing middle names or initials fold into
 * `firstName` exactly as the manual Add-a-student form would accept them.
 *
 * A cell with no comma is read as a given name followed by a surname
 * (`"Ada Lovelace"` -> first `Ada`, last `Lovelace`), since that is how a name
 * typed without the export's convention reads. A single word becomes a last name
 * alone, which leaves the row importable rather than guessing which half a bare
 * `"Cher"` was meant to be.
 */
export function splitFullName(value: string): { firstName: string; lastName: string } {
  const trimmed = value.trim();
  if (trimmed === "") return { firstName: "", lastName: "" };

  const commaIndex = trimmed.indexOf(",");
  if (commaIndex !== -1) {
    return {
      lastName: trimmed.slice(0, commaIndex).trim(),
      firstName: trimmed.slice(commaIndex + 1).trim(),
    };
  }

  // No comma: "First Middle Last" — the last word is the surname.
  const words = trimmed.split(/\s+/);
  if (words.length === 1) return { firstName: "", lastName: words[0] };
  return {
    firstName: words.slice(0, -1).join(" "),
    lastName: words[words.length - 1],
  };
}

// Header (lower-cased) -> roster field. Covers the school export's own spellings
// (`ID`, `Name`) plus the obvious alternatives, so a hand-made file auto-maps
// too. Headers not listed here are left unmapped for the user to map manually.
const ATTENDANCE_HEADER_RULES: Record<string, { field: string; options?: FieldOptions }> = {
  id: { field: "studentIdentifier" },
  "student id": { field: "studentIdentifier" },
  "student identifier": { field: "studentIdentifier" },
  sid: { field: "studentIdentifier" },
  name: { field: "fullName" },
  "full name": { field: "fullName" },
  student: { field: "fullName" },
  "student name": { field: "fullName" },
  "first name": { field: "firstName" },
  first: { field: "firstName" },
  firstname: { field: "firstName" },
  "given name": { field: "firstName" },
  "last name": { field: "lastName" },
  last: { field: "lastName" },
  lastname: { field: "lastName" },
  surname: { field: "lastName" },
  email: { field: "email" },
  "email address": { field: "email" },
  note: { field: "note" },
  notes: { field: "note" },
  comment: { field: "note" },
};

/**
 * Best-effort auto-mapping for a roster export's headers: the column mapping
 * implied by recognized header names. Unknown headers are skipped. Used to seed
 * the mapping UI.
 */
export function autoMapAttendanceHeaders(headers: string[]): {
  columnMapping: ColumnMapping;
  fieldOptions: FieldOptionsMap;
} {
  const columnMapping: ColumnMapping = {};
  const fieldOptions: FieldOptionsMap = {};
  headers.forEach((header, index) => {
    const rule = ATTENDANCE_HEADER_RULES[header.trim().toLowerCase()];
    if (!rule) return;
    columnMapping[String(index)] = rule.field;
    if (rule.options) fieldOptions[String(index)] = rule.options;
  });
  return { columnMapping, fieldOptions };
}

/** One roster row resolved to the fields `addStudent` takes. */
interface RosterRowInput {
  firstName: string;
  lastName: string;
  studentIdentifier: string;
  email: string;
  note: string;
}

/**
 * Builds an `addStudent` input from one CSV record.
 *
 * A mapped `fullName` supplies each half only where an explicit first/last
 * column did not, so a file carrying both kinds of column is read the
 * unambiguous way regardless of the order its columns happen to appear in.
 * Throws if no name resolves — a roster row that names nobody is the one thing
 * this import cannot make sense of.
 */
function recordToStudentInput(
  record: string[],
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
): RosterRowInput {
  let firstName = "";
  let lastName = "";
  let studentIdentifier = "";
  let email = "";
  let note = "";
  // Held aside and applied after the loop, so column order can't decide whether
  // the split or the explicit column wins.
  let splitFirstName = "";
  let splitLastName = "";

  for (const cell of applyMapping(record, columnMapping, fieldOptions)) {
    // A constant value stands in for the cell, same as every other importer.
    const raw = cell.options.constantValue?.trim() || cell.rawValue;
    const value = raw.trim();

    switch (cell.field) {
      case "fullName": {
        if (value === "") break;
        const split = splitFullName(value);
        splitFirstName = split.firstName;
        splitLastName = split.lastName;
        break;
      }
      case "firstName":
        if (value !== "") firstName = value;
        break;
      case "lastName":
        if (value !== "") lastName = value;
        break;
      case "studentIdentifier":
        studentIdentifier = value;
        break;
      case "email":
        email = value;
        break;
      case "note":
        note = value;
        break;
      default:
        break; // unknown field name — ignore
    }
  }

  if (firstName === "") firstName = splitFirstName;
  if (lastName === "") lastName = splitLastName;

  if (firstName === "" && lastName === "") {
    throw new Error("no name column mapped, or its cell was empty");
  }

  return { firstName, lastName, studentIdentifier, email, note };
}

/** What an import did, beyond the per-row results. */
export interface RosterImportResult extends ImportSummary {
  /**
   * The class the students were enrolled into — created, or reused by name.
   *
   * Absent when the file imported nobody: there is no reason to leave an empty
   * class behind for a file that turned out to be blank or entirely malformed.
   */
  attendanceClass?: AttendanceClass;
  /** Whether this import created that class rather than finding it. */
  createdClass: boolean;
  /** How many of the imported students were newly enrolled into it. */
  enrolledCount: number;
}

/**
 * Imports a roster from CSV text and enrolls everyone imported into `className`.
 *
 * The class is **created if no class has that name, and reused if one does** —
 * importing a second file into a class that already exists is a normal thing to
 * do, and two classes sharing a name would be worse than either alternative.
 *
 * Best-effort per row: every parseable row is imported, and each failing row is
 * recorded (never silently dropped) in the returned summary. The first record is
 * the header row and is skipped. **Fully-blank records are ignored rather than
 * skipped** — school exports interleave a blank line between every student and
 * trail several at the end, and those are formatting, not failures, so counting
 * them as skips would report a clean import as half-broken.
 */
export function importAttendanceRoster(
  repo: AttendanceRepository,
  fileText: string,
  input: ImportRosterInput,
): RosterImportResult {
  const { className, columnMapping, fieldOptions } = importRosterSchema.parse(input);

  const dataRecords = parseCsvRecords(fileText).slice(1); // drop the header row
  const results: ImportRowResult[] = [];
  const imported: Student[] = [];

  dataRecords.forEach((record, index) => {
    const rowNumber = index + 2; // 1-based, +1 for the header row
    if (record.every((cell) => cell.trim() === "")) return;

    try {
      imported.push(addStudent(repo, recordToStudentInput(record, columnMapping, fieldOptions)));
      results.push({ rowNumber, status: "imported" });
    } catch (error) {
      results.push({
        rowNumber,
        status: "skipped",
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }
  });

  // Resolved after the rows, and only if there is someone to put in it — a file
  // that imports nobody shouldn't leave an empty class behind.
  if (imported.length === 0) {
    return { ...summarizeImportResults(results), createdClass: false, enrolledCount: 0 };
  }

  const existing = repo.getClassByName(className);
  const attendanceClass = existing ?? repo.createClass({ name: className, description: "" });

  const { addedCount } = enrollStudents(repo, {
    classId: attendanceClass.id,
    studentIds: imported.map((student) => student.id),
  });

  return {
    ...summarizeImportResults(results),
    attendanceClass,
    createdClass: existing === undefined,
    enrolledCount: addedCount,
  };
}
