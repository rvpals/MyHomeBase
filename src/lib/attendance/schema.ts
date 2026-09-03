import { z } from "zod";
import { ATTENDANCE_ACTION_ICONS } from "./action-icons";
import { ATTENDANCE_STATUSES, CLASS_WEEKDAYS, CLASS_WEEKDAY_UNSET } from "./types";

/** YYYY-MM-DD. Rejects a timestamp so a date column never gains a time part. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.");

export const studentSchema = z.object({
  id: z.number().int().positive(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  studentIdentifier: z.string(),
  email: z.string(),
  note: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// The optional fields default to "" so the repository always has a value to
// write — the tables are NOT NULL with a blank default, matching the exp_*
// convention that a missing value is blank rather than NULL.
export const createStudentSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required."),
  lastName: z.string().trim().min(1, "Last name is required."),
  studentIdentifier: z.string().trim().default(""),
  // Validated only when non-blank: a roster entry with no email is ordinary,
  // but a typo'd one should be caught rather than stored.
  email: z
    .string()
    .trim()
    .default("")
    .refine(
      (value) => value === "" || z.string().email().safeParse(value).success,
      "Enter a valid email address, or leave it blank.",
    ),
  note: z.string().trim().default(""),
});

export type CreateStudentInput = z.input<typeof createStudentSchema>;
export type StudentWriteData = z.output<typeof createStudentSchema>;

export const updateStudentSchema = createStudentSchema;
export type UpdateStudentInput = z.input<typeof updateStudentSchema>;

/**
 * A class as it comes *out* of the database.
 *
 * Separate from `createClassSchema` because the two directions admit different
 * weekdays: this one accepts `CLASS_WEEKDAY_UNSET` so a class predating
 * migration 0080 stays readable, while the write schema below requires a real
 * 1-5 so that `0` can never be stored by anything going through a form. Same
 * readable-but-not-writable split `statement_close_day` uses in the Expense
 * module (migration 0070).
 */
export const attendanceClassSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string(),
  // A literal union rather than z.enum: zod's enum takes strings, and these are
  // the numbers Date.getDay() speaks.
  classWeekday: z.union([
    z.literal(CLASS_WEEKDAY_UNSET),
    ...CLASS_WEEKDAYS.map((weekday) => z.literal(weekday)),
  ]),
  enrolledCount: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createClassSchema = z.object({
  name: z.string().trim().min(1, "Class name is required."),
  description: z.string().trim().default(""),
  /**
   * Which weekday the class meets on. Required, and only Monday to Friday: a
   * class the home screen can't recognise as "today's" is the thing this field
   * exists to prevent, so the form makes you choose rather than defaulting to a
   * day you never confirmed.
   *
   * `z.coerce` because both boundaries hand this over as a string — an HTML
   * `<select>` value and a CLI argument are both text.
   */
  classWeekday: z.coerce
    .number({ message: "Pick the weekday this class meets on." })
    .int()
    .refine(
      (value): value is (typeof CLASS_WEEKDAYS)[number] =>
        (CLASS_WEEKDAYS as readonly number[]).includes(value),
      "Pick a weekday from Monday to Friday.",
    ),
});

export type CreateClassInput = z.input<typeof createClassSchema>;

/**
 * What the repository is handed to store a class.
 *
 * `classWeekday` is widened back to `number` from the schema's 1-5, because the
 * repository has one writer the form schema isn't the right gate for: the CSV
 * roster importer, which stores `CLASS_WEEKDAY_UNSET` since a file names a class
 * but says nothing about when it meets. The narrow bound still holds where it
 * matters — `createClass`/`updateClass` parse through `createClassSchema`, so
 * nothing reaching the repository from a form or the CLI can carry a `0`.
 */
export type ClassWriteData = Omit<z.output<typeof createClassSchema>, "classWeekday"> & {
  classWeekday: number;
};

export const updateClassSchema = createClassSchema;
export type UpdateClassInput = z.input<typeof updateClassSchema>;

/** Adding a selection of students to an existing class. */
export const enrollStudentsSchema = z.object({
  classId: z.number().int().positive(),
  studentIds: z.array(z.number().int().positive()).min(1, "Select at least one student."),
});

export type EnrollStudentsInput = z.input<typeof enrollStudentsSchema>;

/** The ids a bulk delete applies to. */
export const studentIdsSchema = z
  .array(z.number().int().positive())
  .min(1, "Select at least one student.");

/**
 * Importing a roster from a CSV.
 *
 * The class name is required rather than optional: an import always lands in a
 * class, which is created if nothing has that name and reused if something does.
 * The mapping types are re-declared here as plain records rather than imported
 * from `@/lib/csv-import` so this module's schema file stays self-contained —
 * the import adapter is what knows those keys are CSV column indexes.
 */
export const importRosterSchema = z.object({
  className: z.string().trim().min(1, "A class name is required."),
  columnMapping: z.record(z.string(), z.string()),
  fieldOptions: z
    .record(
      z.string(),
      z.object({
        delimiter: z.string().optional(),
        dateFormat: z.string().optional(),
        constantValue: z.string().optional(),
      }),
    )
    .default({}),
});

export type ImportRosterInput = z.input<typeof importRosterSchema>;

/**
 * A student action in the catalog.
 *
 * The code is uppercased rather than merely trimmed, so `l` typed in a hurry and
 * `L` are the one code the unique NOCASE index already treats them as — the
 * stored value then matches what every report prints.
 */
export const createStudentActionSchema = z.object({
  name: z.string().trim().min(1, "Action name is required."),
  code: z
    .string()
    .trim()
    .min(1, "A short code is required.")
    .max(6, "A code is meant to be short — 6 characters at most.")
    .transform((value) => value.toUpperCase()),
  description: z.string().trim().default(""),
  // Blank is allowed: an action with no glyph draws its code alone, which is a
  // legitimate choice rather than a half-filled form.
  icon: z
    .union([z.enum(ATTENDANCE_ACTION_ICONS), z.literal("")])
    .default(""),
  sequence: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

export type CreateStudentActionInput = z.input<typeof createStudentActionSchema>;
export type StudentActionWriteData = z.output<typeof createStudentActionSchema>;

export const updateStudentActionSchema = createStudentActionSchema;
export type UpdateStudentActionInput = z.input<typeof updateStudentActionSchema>;

export const attendanceEntrySchema = z.object({
  studentId: z.number().int().positive(),
  status: z.enum(ATTENDANCE_STATUSES),
  /**
   * The catalog ids of the actions noted for this student. Defaults to empty —
   * most students in most sessions have none, and the CLI's simplest form
   * shouldn't have to say so.
   */
  actionIds: z.array(z.number().int().positive()).default([]),
});

/**
 * Saving a day's attendance.
 *
 * The date is supplied by the caller rather than defaulted here: a use-case
 * that reads the clock isn't a pure function, and both adapters (the web form
 * and the CLI) already know what "today" means for their own timezone.
 */
export const saveAttendanceSchema = z.object({
  classId: z.number().int().positive(),
  attendanceDate: isoDateSchema,
  recordedByUserId: z.number().int().positive(),
  entries: z.array(attendanceEntrySchema).min(1, "A class needs at least one student."),
});

export type SaveAttendanceInput = z.input<typeof saveAttendanceSchema>;
export type SaveAttendanceData = z.output<typeof saveAttendanceSchema>;

/** Asking for a report: one class, one date. */
export const attendanceReportQuerySchema = z.object({
  classId: z.number().int().positive(),
  attendanceDate: isoDateSchema,
});

export type AttendanceReportQuery = z.input<typeof attendanceReportQuerySchema>;
