import { z } from "zod";
import { pruneRedundantFolders } from "./folders";
import { DEFAULT_TARGET_SECONDS } from "./types";

// Zod schemas for everything crossing a boundary into this module -- a server action or a
// CLI argument. The presentation layers validate with these rather than trusting input,
// per ARCHITECTURE.md.

/** One minute. Below this a playlist is a single track, and the target stops meaning anything. */
export const MIN_TARGET_SECONDS = 60;

/**
 * Twelve hours. Not a storage limit -- a guard on the WORK: the generator materialises
 * its candidate set to shuffle it, and a target nobody wants would happily select
 * thousands of rows and hand them all to a browser.
 */
export const MAX_TARGET_SECONDS = 12 * 60 * 60;

/**
 * How many values one criteria field may hold.
 *
 * The pickers are driven by the catalog, which has tens of genres and thousands of
 * artists, so a legitimate selection is small. The cap exists because each value becomes
 * a bound parameter in an IN clause, and SQLite's parameter limit is a real ceiling --
 * better to refuse 501 artists with a message than to build a statement that will not
 * prepare.
 */
const MAX_CRITERIA_VALUES = 500;

/**
 * A genre or artist name.
 *
 * `.min(0)` is deliberate and load-bearing: '' is a REAL criterion here, selecting the
 * untagged group, exactly as it does in `TrackSearchQuery`. Plenty of this library
 * carries no genre tag, and "no genre" is a category a listener can pick. Not trimmed
 * for the same reason -- trimming '' to '' is fine, but trimming would also quietly
 * rewrite a tag that genuinely has leading space and then fail to match it.
 */
const criteriaNameSchema = z.string().max(400);

/**
 * A folder path relative to the music root, e.g. `Rock/Queen`.
 *
 * Longer than a tag because a path accumulates its ancestors' names -- 400 characters is
 * a plausible nesting depth on a NAS, 1000 is not. Trailing slashes are trimmed rather
 * than rejected: SQL's folder expression yields them (`rtrim(relative_path, ...)` leaves
 * the separator on), so a path picked straight out of the catalog can arrive with one and
 * refusing it would be refusing our own output.
 *
 * Backslashes are rewritten to forward slashes for the same reason the scanner stores
 * them that way: the NAS is reached over a Windows path, but `relative_path` is
 * normalised, and a criterion that kept `\` would match nothing.
 *
 * Unlike `criteriaNameSchema` there is no meaningful empty value -- '' is the library
 * root, not an "untagged" group -- so it is dropped by the transform on the field rather
 * than accepted as a criterion.
 */
const folderPathSchema = z
  .string()
  .max(1000)
  .transform((path) => path.replace(/[\\]/g, "/").replace(/[/]+$/, ""));

/**
 * A single folder path, for the picker's "list one level" call.
 *
 * `.default("")` because the top level is addressed by asking for the root, and a picker
 * opening for the first time has no parent to name -- so the absent case must mean "start
 * at the top" rather than be an error. Reuses `folderPathSchema`, so a path typed on the
 * command line is normalised exactly as one clicked in the browser is.
 */
export const magicFolderPathSchema = folderPathSchema.default("");

/** The selection criteria, as the form posts them. */
export const magicCriteriaSchema = z.object({
  genres: z.array(criteriaNameSchema).max(MAX_CRITERIA_VALUES).default([]),
  artists: z.array(criteriaNameSchema).max(MAX_CRITERIA_VALUES).default([]),
  albumIds: z
    .array(z.coerce.number().int().positive())
    .max(MAX_CRITERIA_VALUES)
    .default([]),
  folders: z
    .array(folderPathSchema)
    .max(MAX_CRITERIA_VALUES)
    .default([])
    // Pruned at the BOUNDARY, so no caller can store a parent and its own child and then
    // wonder which one is in force. `pruneRedundantFolders` also drops '' -- the root
    // restricts nothing, and letting it through would make one stray entry silently mean
    // "the whole library" no matter what else was picked.
    .transform((paths) => pruneRedundantFolders(paths)),
  targetSeconds: z.coerce
    .number()
    .int()
    .min(MIN_TARGET_SECONDS, "A playlist needs to be at least a minute long.")
    .max(MAX_TARGET_SECONDS, "Twelve hours is the longest playlist this will build.")
    .default(DEFAULT_TARGET_SECONDS),
  matchAny: z.boolean().default(false),
  streamableOnly: z.boolean().default(true),
});
export type MagicCriteriaInput = z.infer<typeof magicCriteriaSchema>;

/** Generating without saving: just the criteria. */
export const generateMagicSchema = magicCriteriaSchema;

export const magicListIdSchema = z.coerce.number().int().positive();

/** Creating or updating a saved list: a name, and the criteria to store under it. */
export const magicListWriteSchema = z.object({
  name: z.string().trim().min(1, "A magic list needs a name.").max(120),
  description: z.string().trim().max(500).default(""),
  criteria: magicCriteriaSchema,
});
export type MagicListWriteInput = z.infer<typeof magicListWriteSchema>;

/** Updating an existing saved list. */
export const magicListUpdateSchema = magicListWriteSchema.extend({
  magicListId: magicListIdSchema,
});
export type MagicListUpdateInput = z.infer<typeof magicListUpdateSchema>;
