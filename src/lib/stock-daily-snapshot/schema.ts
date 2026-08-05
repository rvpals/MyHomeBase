import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date.");

// Values can't be negative (you can't hold a negative amount of a thing), but every
// gain/loss can — a down day is the normal case, not an error.
export const dailySnapshotSchema = z.object({
  snapshotDate: isoDate,
  stockValueCents: z.number().int().nonnegative(),
  etfValueCents: z.number().int().nonnegative(),
  otherValueCents: z.number().int().nonnegative(),
  totalValueCents: z.number().int().nonnegative(),
  stockGainLossCents: z.number().int(),
  etfGainLossCents: z.number().int(),
  otherGainLossCents: z.number().int(),
  totalGainLossCents: z.number().int(),
  positionCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * A snapshot on its way into the table. The two totals are computed from the parts
 * by `computeDailySnapshot`, never supplied by a caller — a hand-passed total that
 * disagreed with its components would be undetectable later.
 */
export const upsertDailySnapshotSchema = z.object({
  snapshotDate: isoDate,
  stockValueCents: z.number().int().nonnegative(),
  etfValueCents: z.number().int().nonnegative(),
  otherValueCents: z.number().int().nonnegative(),
  stockGainLossCents: z.number().int(),
  etfGainLossCents: z.number().int(),
  otherGainLossCents: z.number().int(),
  positionCount: z.number().int().nonnegative(),
});

export type UpsertDailySnapshotInput = z.infer<typeof upsertDailySnapshotSchema>;

/** An inclusive date range for reading snapshots back. */
export const snapshotRangeSchema = z
  .object({ fromDate: isoDate, toDate: isoDate })
  .refine((range) => range.fromDate <= range.toDate, {
    message: "fromDate must not be after toDate.",
  });

export type SnapshotRangeInput = z.infer<typeof snapshotRangeSchema>;
