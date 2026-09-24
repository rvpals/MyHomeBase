import { z } from "zod";
import { NO_WATCH, WATCH_KINDS } from "./types";

export const stockWatchListSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createWatchListSchema = z.object({
  name: z.string().min(1),
});

export type CreateWatchListInput = z.infer<typeof createWatchListSchema>;

export const renameWatchListSchema = createWatchListSchema;

export type RenameWatchListInput = z.infer<typeof renameWatchListSchema>;

/**
 * The watch condition's own fields, shared by the row schema and the write
 * schema so a stored row and an accepted input can never disagree about what a
 * watch is.
 *
 * `watchKind` includes the empty string: not watching is a legitimate state and
 * the default one.
 */
export const watchKindSchema = z.enum(WATCH_KINDS);

export const watchKindOrNoneSchema = z.union([z.literal(NO_WATCH), watchKindSchema]);

/**
 * Non-negative, for every unit it might hold.
 *
 * Non-negative for the swing kinds too: "gain or loss of 20%" states the *size*
 * of the swing, and the evaluator compares it in both directions. Letting the
 * reader type -20 for the same thing would give one condition two spellings —
 * the same rule `targetCentsSchema` follows in `@/lib/ticker-monitors`.
 */
export const watchValueSchema = z
  .number()
  .nonnegative("A watch value cannot be negative.")
  .finite("A watch value must be a number.");

const watchFieldsSchema = z.object({
  watchKind: watchKindOrNoneSchema.default(NO_WATCH),
  watchValue: watchValueSchema.default(0),
  watchValueHigh: watchValueSchema.default(0),
});

/**
 * Cross-field check: the value the chosen kind actually reads must be set, and
 * a range must be a range.
 *
 * Every column exists on every row (see migrations/0111), so nothing structural
 * stops a caller saving `price` with `watchValue: 0`. That would store "tell me
 * when this hits $0", which is not what anyone picking that kind meant — a 0
 * there is a forgotten field, and the boundary is where it gets caught rather
 * than in the evaluator.
 *
 * The event kinds are exempt: they read no value at all.
 */
function requireValueForKind(
  value: { watchKind: string; watchValue: number; watchValueHigh: number },
  ctx: z.RefinementCtx,
): void {
  if (value.watchKind === "price" && value.watchValue <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["watchValue"],
      message: "Set the price to watch for.",
    });
  }

  if (value.watchKind === "gain_loss_pct" && value.watchValue <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["watchValue"],
      message: "Set the percentage swing to watch for.",
    });
  }

  if (value.watchKind === "gain_loss_price" && value.watchValue <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["watchValue"],
      message: "Set the per-share swing to watch for.",
    });
  }

  if (value.watchKind === "price_range") {
    if (value.watchValue <= 0 || value.watchValueHigh <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["watchValue"],
        message: "Set both ends of the price range.",
      });
      return;
    }
    // A range whose low is above its high can never contain anything, so it is
    // a silently inert watch — the worst failure mode for an alert. Equal ends
    // are refused for the same reason: that is a `price` watch spelled oddly.
    if (value.watchValue >= value.watchValueHigh) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["watchValueHigh"],
        message: "The high end of the range must be above the low end.",
      });
    }
  }
}

// Deliberately NOT refined with `requireValueForKind`. This parses rows coming
// *out* of the database, and a row written before 0111 — or by a hand-edited
// SQL statement — must still read back rather than throwing on the way to a
// screen. The refinement guards the write path, which is where a bad watch can
// actually be introduced.
export const stockWatchListItemSchema = z.object({
  id: z.number().int().positive(),
  watchListId: z.number().int().positive(),
  ticker: z.string().min(1),
  shares: z.number().nonnegative(),
  priceWhenAddedCents: z.number().int().nonnegative(),
  addedDate: z.string().min(1),
  reminderAt: z.string().optional(),
  reminderMessage: z.string(),
  watchKind: watchKindOrNoneSchema,
  watchValue: z.number(),
  watchValueHigh: z.number(),
  watchIsTriggered: z.boolean(),
  watchLastTriggeredAt: z.string().optional(),
  watchLastMessage: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// priceWhenAddedCents is not accepted here — the use-case fetches a live quote
// and supplies it, same rule as stock_positions.value_cents.
export const addWatchListItemSchema = z
  .object({
    watchListId: z.number().int().positive(),
    ticker: z.string().min(1),
    shares: z.number().nonnegative().default(0),
    addedDate: z.string().min(1),
  })
  .merge(watchFieldsSchema)
  .superRefine(requireValueForKind);

export type AddWatchListItemInput = z.input<typeof addWatchListItemSchema>;

/** Changing (or clearing) the watch on a row that already exists. */
export const updateWatchListItemWatchSchema = watchFieldsSchema.superRefine(requireValueForKind);

export type UpdateWatchListItemWatchInput = z.input<typeof updateWatchListItemWatchSchema>;

/** The validated shape, after defaults. */
export type UpdateWatchListItemWatch = z.output<typeof updateWatchListItemWatchSchema>;

export const updateWatchListItemReminderSchema = z.object({
  reminderAt: z.string().optional(),
  reminderMessage: z.string().default(""),
});

export type UpdateWatchListItemReminderInput = z.infer<typeof updateWatchListItemReminderSchema>;
