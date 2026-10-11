// Boundary validation for the Data backup settings. Every value the admin screen
// and the CLI can send passes through here before it reaches a use-case.

import { z } from "zod";
import { BACKUP_INTERVALS, MAX_KEEP_COUNT, MIN_KEEP_COUNT } from "./types";

// No cast: `BACKUP_INTERVALS` is an `as const` tuple, so `z.enum` keeps the literal
// union and `backupSettingsInputSchema` infers `interval: BackupInterval` rather
// than `string`. Casting it to `[string, ...string[]]` is what broke the build.
export const backupIntervalSchema = z.enum(BACKUP_INTERVALS);

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
  interval: backupIntervalSchema,
  startTime: startTimeSchema,
});

export type BackupSettingsInput = z.infer<typeof backupSettingsInputSchema>;
