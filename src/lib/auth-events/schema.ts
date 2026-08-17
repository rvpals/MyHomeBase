import { z } from "zod";

/**
 * Longest string kept for a typed username. People do type their password into the
 * username field, so a failure row can hold a real secret — truncating bounds the
 * exposure without making the column useless (see migrations/0045).
 */
export const MAX_ATTEMPTED_USERNAME_LENGTH = 200;

/** User agents are long and unbounded; nothing on the screen needs more than this. */
export const MAX_USER_AGENT_LENGTH = 400;

export const authEventTypeSchema = z.enum(["login_success", "login_failure", "logout"]);

export const authFailureReasonSchema = z.enum([
  "unknown_user",
  "bad_password",
  "account_disabled",
  "invalid_input",
]);

/**
 * Trims, drops blanks to `undefined`, and truncates. Applied to every free-text field
 * on the way in so the recorder can never be the thing that fails a login: a
 * hostile 8 KB user-agent header becomes a short string rather than a write error.
 */
function boundedText(max: number) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed.slice(0, max);
  }, z.string().min(1).optional());
}

/**
 * The boundary schema for recording an event. Blank-to-`undefined` happens here, once,
 * so neither the use-case nor the repository compares against "" — the table's blank
 * sentinel is a storage detail (migrations/0045).
 */
export const newAuthEventSchema = z.object({
  eventType: authEventTypeSchema,
  attemptedUsername: boundedText(MAX_ATTEMPTED_USERNAME_LENGTH),
  userId: z.number().int().positive().optional(),
  failureReason: authFailureReasonSchema.optional(),
  ipAddress: boundedText(100),
  userAgent: boundedText(MAX_USER_AGENT_LENGTH),
});

export type NewAuthEventInput = z.infer<typeof newAuthEventSchema>;

/** A stored row, validated on the way out of the database. */
export const authEventSchema = z.object({
  id: z.number().int().positive(),
  eventType: authEventTypeSchema,
  attemptedUsername: z.string().min(1).optional(),
  userId: z.number().int().positive().optional(),
  failureReason: authFailureReasonSchema.optional(),
  ipAddress: z.string().min(1).optional(),
  userAgent: z.string().min(1).optional(),
  reviewedAt: z.string().min(1).optional(),
  createdAt: z.string().min(1),
});

/**
 * Filters from the admin screen. `limit` is capped so a hand-edited query string
 * can't ask for the whole table, and defaulted so every caller gets a bounded read.
 */
export const authEventFilterSchema = z.object({
  eventType: authEventTypeSchema.optional(),
  username: boundedText(MAX_ATTEMPTED_USERNAME_LENGTH),
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
    .optional(),
  limit: z.number().int().positive().max(1000).default(200),
});

export type AuthEventFilterInput = z.infer<typeof authEventFilterSchema>;

/** Guards the prune job. A floor of 1 day stops a bad config wiping the table outright. */
export const retentionDaysSchema = z.number().int().min(1).max(3650);
