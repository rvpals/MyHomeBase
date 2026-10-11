// Boundary validation for the "Hello, world!" settings. Every value the admin
// screen and the CLI can send passes through here before it reaches a use-case.

import { z } from "zod";
import {
  INTERVAL_UNITS,
  MAX_INTERVAL_COUNT,
  MAX_MESSAGE_LENGTH,
  MIN_INTERVAL_COUNT,
} from "./types";

// No cast: `INTERVAL_UNITS` is an `as const` tuple, so `z.enum` keeps the literal
// union and the input type infers `intervalUnit: IntervalUnit` rather than `string`.
export const intervalUnitSchema = z.enum(INTERVAL_UNITS);

/**
 * The message the job prints.
 *
 * Non-empty at the boundary, unlike the resolver's forgiving default: a reader who
 * clears the box and presses Save meant to type something, and silently storing
 * "Hello, world!" over their empty field would look like the save was ignored. The
 * resolver's default covers a *stored* blank, which is a different situation -- a
 * hand-edited row, where the scheduler must keep running regardless.
 */
export const helloWorldMessageSchema = z
  .string()
  .trim()
  .min(1, "Enter a message.")
  .max(MAX_MESSAGE_LENGTH, `Keep the message under ${MAX_MESSAGE_LENGTH} characters.`);

/**
 * The number half of the cadence.
 *
 * Coerced because the admin screen's number input hands back a string, and `int()`
 * so "every 1.5 hours" is rejected at the boundary rather than becoming a float the
 * cadence arithmetic would silently accept.
 */
export const intervalCountSchema = z.coerce
  .number({ message: "Enter how often to run." })
  .int("Enter a whole number.")
  .min(MIN_INTERVAL_COUNT, `Run at least every ${MIN_INTERVAL_COUNT}.`)
  .max(MAX_INTERVAL_COUNT, `Enter ${MAX_INTERVAL_COUNT} or less.`);

export const helloWorldSettingsInputSchema = z.object({
  enabled: z.boolean(),
  message: helloWorldMessageSchema,
  intervalCount: intervalCountSchema,
  intervalUnit: intervalUnitSchema,
});

export type HelloWorldSettingsInput = z.infer<typeof helloWorldSettingsInputSchema>;
