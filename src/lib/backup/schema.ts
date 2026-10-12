// Boundary validation for the Data backup settings. Every value the admin screen
// and the CLI can send passes through here before it reaches a use-case.

import { z } from "zod";
import { MAX_KEEP_COUNT, MIN_KEEP_COUNT } from "./types";

// The cadence halves are the "Hello, world!" job's, re-exported rather than
// redeclared -- the constraints are identical (a whole number 1..1000 and one of a
// closed set of units), and a second copy would be a second thing to keep in step
// with `INTERVAL_UNITS`. Same reasoning as the re-exports in `./types`.
//
// Imported as well as re-exported: the object schemas below compose them, and a
// bare `export ... from` would not bring them into this module's own scope.
import { intervalCountSchema, intervalUnitSchema } from "@/lib/hello-world/schema";

export { intervalCountSchema, intervalUnitSchema };

/**
 * How many archives to keep.
 *
 * Coerced because the admin screen's number input hands back a string, and
 * `int()` rather than a bare number so "7.5 backups" is rejected at the boundary
 * instead of becoming a float that the prune then compares against a count.
 */
export const keepCountSchema = z.coerce
  .number({ message: "Enter how many backups to keep." })
  .int("Enter a whole number of backups.")
  .min(MIN_KEEP_COUNT, `Keep at least ${MIN_KEEP_COUNT} backup.`)
  .max(MAX_KEEP_COUNT, `Keep at most ${MAX_KEEP_COUNT} backups.`);

/**
 * A folder path, or blank.
 *
 * Blank is allowed here and rejected later by the preflight: a reader must be able
 * to save a half-filled form without the box refusing to empty. 500 matches
 * `hsaReceiptRootSchema`.
 */
export const backupFolderSchema = z.string().trim().max(500, "That path is too long.");

/**
 * The anchor time, `HH:MM` on a 24-hour clock.
 *
 * A string rather than a number of minutes because that is what `<input type="time">`
 * produces and what a reader recognises; `toMinutesOfDay` in settings.ts converts it.
 */
export const startTimeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time as HH:MM, e.g. 17:00.");

export const backupSettingsInputSchema = z.object({
  enabled: z.boolean(),
  attachmentRoot: backupFolderSchema,
  databaseRoot: backupFolderSchema,
  keepCount: keepCountSchema,
  intervalCount: intervalCountSchema,
  intervalUnit: intervalUnitSchema,
  startTime: startTimeSchema,
});

/**
 * Just the schedule half of the form, for the Background Tasks screen.
 *
 * A separate schema rather than a `.pick()` because the two screens now own
 * disjoint halves of these settings: Backup Data owns the folders and the keep
 * count, Background Tasks owns the switch and the cadence. Each saves only what it
 * renders, so neither can blank a field it never showed.
 */
export const backupScheduleInputSchema = z.object({
  enabled: z.boolean(),
  intervalCount: intervalCountSchema,
  intervalUnit: intervalUnitSchema,
  startTime: startTimeSchema,
});

export type BackupScheduleInput = z.infer<typeof backupScheduleInputSchema>;

/**
 * The folder half, owned by Backup Data. The complement of `backupScheduleInput`.
 */
export const backupFoldersInputSchema = z.object({
  attachmentRoot: backupFolderSchema,
  databaseRoot: backupFolderSchema,
  keepCount: keepCountSchema,
});

export type BackupFoldersInput = z.infer<typeof backupFoldersInputSchema>;

export type BackupSettingsInput = z.infer<typeof backupSettingsInputSchema>;
