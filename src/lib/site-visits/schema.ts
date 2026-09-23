import { z } from "zod";

/** User agents are long and unbounded; nothing on the screen needs more than this. */
export const MAX_USER_AGENT_LENGTH = 400;

/** Referers can carry a whole query string. Bounded for the same reason. */
export const MAX_REFERER_LENGTH = 400;

/**
 * Long enough for an IPv6 address with a zone and a port, short enough that a hostile
 * `x-forwarded-for` header is truncated rather than stored whole.
 */
export const MAX_IP_LENGTH = 100;

/** How many rows a bulk delete or bulk allow may touch in one call. */
export const MAX_BULK_IDS = 1000;

export const suspicionLevelSchema = z.enum(["normal", "watch", "suspicious"]);

/**
 * The reasons behind a verdict (migrations/0106). Mirrors `SuspicionSignal` exactly.
 *
 * Only validates values the domain produces; the *stored* string is decoded by
 * `decodeSignals`, which drops unknown keys rather than rejecting the row.
 */
export const suspicionSignalSchema = z.enum([
  "no_user_agent",
  "tool_user_agent",
  "scanner_user_agent",
  "burst",
  "never_signs_in",
  "auth_failures",
  "allowlist_removed",
]);

/**
 * Trims, drops blanks to `undefined`, and truncates. Applied to every free-text field
 * on the way in so the recorder can never be the thing that breaks a page render: a
 * hostile 8 KB user-agent header becomes a short string rather than a write error.
 *
 * Same helper, same reasoning, as `auth-events/schema.ts`.
 */
function boundedText(max: number) {
  return z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed.slice(0, max);
  }, z.string().min(1).optional());
}

/**
 * The boundary schema for recording an arrival. Blank-to-`undefined` happens here,
 * once, so neither the use-case nor the repository compares against "" — the table's
 * blank sentinel is a storage detail (migrations/0102).
 */
export const newSiteVisitSchema = z.object({
  ipAddress: boundedText(MAX_IP_LENGTH),
  userAgent: boundedText(MAX_USER_AGENT_LENGTH),
  referer: boundedText(MAX_REFERER_LENGTH),
  path: z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? "/" : trimmed.slice(0, 200);
  }, z.string().min(1).default("/")),
  suspicion: suspicionLevelSchema.optional(),
  signals: z.array(suspicionSignalSchema).optional(),
});

export type NewSiteVisitInput = z.infer<typeof newSiteVisitSchema>;

/** A stored row, validated on the way out of the database. */
export const siteVisitSchema = z.object({
  id: z.number().int().positive(),
  ipAddress: z.string().min(1).optional(),
  userAgent: z.string().min(1).optional(),
  referer: z.string().min(1).optional(),
  path: z.string().min(1),
  suspicion: suspicionLevelSchema,
  // Defaulted, not optional: a row written before 0106 decodes to `[]`, and the
  // screen should never have to tell "no reasons" from "field absent".
  signals: z.array(suspicionSignalSchema).default([]),
  reviewedAt: z.string().min(1).optional(),
  createdAt: z.string().min(1),
});

/**
 * Filters for the Visit tab. `limit` is capped so a hand-edited call can't ask for
 * the whole table, and defaulted so every caller gets a bounded read.
 *
 * The default is higher than the auth log's 200 because this tab groups by week and
 * by day — a fortnight that only half-fills would make the rollup counts lie about
 * what happened, which is worse than a slightly larger read.
 */
export const siteVisitFilterSchema = z.object({
  suspicion: suspicionLevelSchema.optional(),
  ipAddress: boundedText(MAX_IP_LENGTH),
  since: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
    .optional(),
  limit: z.number().int().positive().max(5000).default(1000),
});

export type SiteVisitFilterInput = z.infer<typeof siteVisitFilterSchema>;

/**
 * An address to vouch for.
 *
 * `ipAddress` is required and non-blank — vouching for "nothing" would quietly
 * allowlist every visit whose address could not be determined, which is the exact
 * set of rows a reader most wants to keep looking at.
 *
 * Deliberately NOT validated as a well-formed IPv4/IPv6 literal. The value echoes
 * whatever the proxy put in the header, and rejecting an unusual-but-real shape
 * (an IPv6 zone id, a proxy writing `unknown`) would leave the reader unable to
 * silence a row they can plainly see. The column is a label, not an address type.
 */
export const newIpAllowlistEntrySchema = z.object({
  ipAddress: z
    .string()
    .trim()
    .min(1, "An address is required.")
    .max(MAX_IP_LENGTH),
  label: boundedText(120),
  addedByUserId: z.number().int().positive().optional(),
});

export type NewIpAllowlistEntryInput = z.infer<typeof newIpAllowlistEntrySchema>;

/** A stored allowlist row, validated on the way out of the database. */
export const ipAllowlistEntrySchema = z.object({
  id: z.number().int().positive(),
  ipAddress: z.string().min(1),
  label: z.string().min(1).optional(),
  addedByUserId: z.number().int().positive().optional(),
  createdAt: z.string().min(1),
});

/**
 * Ids for a bulk action. Bounded, deduped, and required to be non-empty so an
 * accidental "delete nothing" is an explicit error rather than a silent success.
 */
export const bulkIdsSchema = z
  .array(z.number().int().positive())
  .min(1, "Select at least one row.")
  .max(MAX_BULK_IDS)
  .transform((ids) => [...new Set(ids)]);

/** Guards the prune job. A floor of 1 day stops a bad config wiping the table outright. */
export const retentionDaysSchema = z.number().int().min(1).max(3650);
