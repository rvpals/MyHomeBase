import { z } from "zod";
import { DEFAULT_MAX_PHOTOS, MAX_LIST_PHOTOS } from "./types";

// Zod schemas for everything crossing a boundary into this module -- a server action or
// a CLI argument. Both presentation layers validate with these rather than trusting
// input, per ARCHITECTURE.md, which is what makes the web form and the command line
// accept exactly the same things.

/** `YYYY-MM-DD`. The format the archive's folder names and EXIF dates both use. */
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  // Rejects 2019-02-31, which the regex alone would happily accept. `Date.parse` on a
  // bare `YYYY-MM-DD` is UTC-anchored and has no zone to shift it, so this comparison
  // is safe -- unlike parsing an EXIF timestamp, which `exif.ts` warns against.
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "That is not a real date.");

/**
 * One gigabyte, as the largest file size a bound may name.
 *
 * Not a storage limit -- a guard against a typo. Someone meaning 5 MB and typing the
 * byte count wrong should be told, rather than silently getting a list that can never
 * match anything in a JPEG archive.
 */
const MAX_BYTES_BOUND = 1024 * 1024 * 1024;

/** A file-size bound in bytes. Non-negative, whole, and capped at something plausible. */
const byteBoundSchema = z.number().int().min(0).max(MAX_BYTES_BOUND);

/**
 * A pixel bound.
 *
 * 65535 is the ceiling because that is what a JPEG's 16-bit frame header can express --
 * a bound above it could never be satisfied by any file the parser can read, so it is a
 * mistake rather than a preference.
 */
const pixelBoundSchema = z.number().int().min(1).max(65535);

/**
 * The whole criteria set.
 *
 * Every bound is `.optional()`, and that is load-bearing rather than lenient: an absent
 * bound means "no restriction on this end", which is the semantics `matchesCriteria`
 * implements. Note there is no `.default(0)` anywhere here -- a zero standing in for
 * "no minimum" is exactly how that rule gets quietly broken.
 */
export const photoMagicCriteriaSchema = z
  .object({
    fromDate: isoDateSchema.optional(),
    toDate: isoDateSchema.optional(),
    minBytes: byteBoundSchema.optional(),
    maxBytes: byteBoundSchema.optional(),
    minWidth: pixelBoundSchema.optional(),
    minHeight: pixelBoundSchema.optional(),
    maxWidth: pixelBoundSchema.optional(),
    maxHeight: pixelBoundSchema.optional(),
    maxPhotos: z.number().int().min(1).max(MAX_LIST_PHOTOS).default(DEFAULT_MAX_PHOTOS),
  })
  // The cross-field checks. Each is a range that is impossible to satisfy rather than
  // merely empty, so catching it here turns a mystifying "no results" into a message
  // naming the mistake. Reported on the field the reader should change -- the upper
  // bound, since they almost always typed that one second.
  .refine(
    (criteria) =>
      criteria.fromDate === undefined ||
      criteria.toDate === undefined ||
      criteria.fromDate <= criteria.toDate,
    { message: "The end date is before the start date.", path: ["toDate"] },
  )
  .refine(
    (criteria) =>
      criteria.minBytes === undefined ||
      criteria.maxBytes === undefined ||
      criteria.minBytes <= criteria.maxBytes,
    { message: "The largest size is below the smallest.", path: ["maxBytes"] },
  )
  .refine(
    (criteria) =>
      criteria.minWidth === undefined ||
      criteria.maxWidth === undefined ||
      criteria.minWidth <= criteria.maxWidth,
    { message: "The widest is below the narrowest.", path: ["maxWidth"] },
  )
  .refine(
    (criteria) =>
      criteria.minHeight === undefined ||
      criteria.maxHeight === undefined ||
      criteria.minHeight <= criteria.maxHeight,
    { message: "The tallest is below the shortest.", path: ["maxHeight"] },
  );

export type PhotoMagicCriteriaInput = z.infer<typeof photoMagicCriteriaSchema>;

/**
 * A list's name.
 *
 * Trimmed and non-empty, matching `pho_albums`' 1-120: a list is chosen from a picker by
 * its name, so a blank or whitespace one is a row nobody can identify. The uniqueness is
 * the database's job (`idx_pho_magic_list_name`, NOCASE), not this schema's.
 */
const listNameSchema = z.string().trim().min(1, "Give the list a name.").max(120);

/** Free text. Blank rather than null, per coding-guide.md. */
const listDescriptionSchema = z.string().trim().max(2000).default("");

/** Creating a list: a name, a description and the criteria to remember. */
export const photoMagicListWriteSchema = z.object({
  name: listNameSchema,
  description: listDescriptionSchema,
  criteria: photoMagicCriteriaSchema,
});

export type PhotoMagicListWriteInput = z.infer<typeof photoMagicListWriteSchema>;

/** Updating one: the same fields plus which list. */
export const photoMagicListUpdateSchema = photoMagicListWriteSchema.extend({
  id: z.number().int().positive(),
});

export type PhotoMagicListUpdateInput = z.infer<typeof photoMagicListUpdateSchema>;

/** Addressing one saved list -- load, regenerate, delete. */
export const photoMagicListIdSchema = z.number().int().positive();

/**
 * Generating from criteria that may not be saved.
 *
 * `listId` is optional because "Create the list" works on whatever is in the form,
 * saved or not -- a reader tries a range before deciding to keep it. When present, the
 * draw is stored against that list; when absent it is returned and nothing is written.
 */
export const generatePhotoMagicSchema = z.object({
  listId: photoMagicListIdSchema.optional(),
  criteria: photoMagicCriteriaSchema,
});

export type GeneratePhotoMagicInput = z.infer<typeof generatePhotoMagicSchema>;

/**
 * Starting a scan over a date range.
 *
 * The range is OPTIONAL at both ends, and an absent one means the whole archive. That
 * is a long walk over SMB and the screen says so before offering the button, but it is
 * a legitimate thing to ask for once -- refusing it would leave no way to index photos
 * whose dates are unknown.
 */
export const scanRangeSchema = z
  .object({
    fromDate: isoDateSchema.optional(),
    toDate: isoDateSchema.optional(),
  })
  .refine(
    (range) =>
      range.fromDate === undefined ||
      range.toDate === undefined ||
      range.fromDate <= range.toDate,
    { message: "The end date is before the start date.", path: ["toDate"] },
  );

export type ScanRangeInput = z.infer<typeof scanRangeSchema>;
