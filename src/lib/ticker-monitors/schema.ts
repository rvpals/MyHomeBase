import { z } from "zod";
import { DEFAULT_BAND_PCT, MONITOR_TYPES } from "./types";

/**
 * The boundary for ticker monitors. The web actions and the CLI both parse
 * their raw input through these, so neither can store a monitor the other
 * could not.
 */

/** Same shape the rest of the Investments module uses for a symbol. */
export const monitorTickerSchema = z
  .string()
  .trim()
  .min(1, "A ticker is required.")
  .max(15)
  .regex(/^[A-Za-z0-9.-]+$/, "A ticker is letters, digits, dots and hyphens.")
  .transform((value) => value.toUpperCase());

export const monitorTypeSchema = z.enum(MONITOR_TYPES);

/**
 * The band has a floor and a ceiling.
 *
 * Above 0 because a 0% band can never be satisfied — the monitor would be
 * silently inert, which is the worst failure mode for an alert. Capped at 100
 * because a band wider than the target itself fires permanently and is
 * indistinguishable from no monitor at all.
 */
export const bandPctSchema = z
  .number()
  .gt(0, "A band of 0% would never match.")
  .max(100, "A band wider than 100% would always match.")
  .default(DEFAULT_BAND_PCT);

/**
 * A target amount, in cents, non-negative.
 *
 * Non-negative for *both* amount types, including the loss one: "unrealized
 * loss near $2,000" states the size of the loss, and the evaluator compares it
 * against a negative gain internally. Letting the reader type -2000 for the
 * same thing would give one condition two spellings.
 */
export const targetCentsSchema = z
  .number()
  .int("A target amount must be a whole number of cents.")
  .min(0, "A target amount cannot be negative.");

export const targetPctSchema = z
  .number()
  .min(0, "A target percentage cannot be negative.")
  // Uncapped above: a 300% gain target is unusual, not wrong.
  .max(100_000, "That target percentage is out of range.");

const monitorFieldsSchema = z.object({
  ticker: monitorTickerSchema,
  monitorType: monitorTypeSchema,
  targetCents: targetCentsSchema.default(0),
  targetPct: targetPctSchema.default(0),
  bandPct: bandPctSchema,
  isEnabled: z.boolean().default(true),
});

/**
 * Cross-field check: the target the chosen type actually reads must be set.
 *
 * Both target columns always exist (see migrations/0110), so nothing structural
 * stops a caller saving a `gain_near_amount` with `targetCents: 0`. That would
 * store a monitor meaning "tell me when my gain is near nothing", which is not
 * what anyone picking that type meant — a 0 there is a forgotten field, and the
 * boundary is where it gets caught rather than at the evaluator.
 *
 * `loss_near_amount` is deliberately exempt: 0 is its most useful target.
 */
function requireTargetForType(
  value: { monitorType: string; targetCents: number; targetPct: number },
  ctx: z.RefinementCtx,
): void {
  if (value.monitorType === "gain_near_amount" && value.targetCents <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetCents"],
      message: "Set the gain amount to watch for.",
    });
  }
  if (value.monitorType === "gain_near_pct_of_cost" && value.targetPct <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["targetPct"],
      message: "Set the percentage of cost basis to watch for.",
    });
  }
}

export const createMonitorSchema = monitorFieldsSchema.superRefine(requireTargetForType);

export const updateMonitorSchema = monitorFieldsSchema
  .extend({ id: z.number().int().positive() })
  .superRefine(requireTargetForType);

export const monitorIdSchema = z.number().int().positive();

export const setMonitorEnabledSchema = z.object({
  id: monitorIdSchema,
  isEnabled: z.boolean(),
});

/**
 * What a caller supplies — the **input** shape, so the defaulted fields
 * (`targetCents`, `targetPct`, `bandPct`, `isEnabled`) may be omitted and the
 * ticker may be lower case.
 *
 * `z.input`, not `z.infer`: `z.infer` is the *output* type, which would make
 * every defaulted field required at the call site and defeat the defaults the
 * schema declares. Same convention as `CreateEntryInput` in `lib/journal`.
 */
export type CreateMonitorInput = z.input<typeof createMonitorSchema>;
export type UpdateMonitorInput = z.input<typeof updateMonitorSchema>;
export type SetMonitorEnabledInput = z.input<typeof setMonitorEnabledSchema>;

/** The validated shapes, after defaults and the ticker's uppercasing. */
export type CreateMonitor = z.output<typeof createMonitorSchema>;
export type UpdateMonitor = z.output<typeof updateMonitorSchema>;
