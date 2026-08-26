import { z } from "zod";
import { isSafeRelativePath } from "./paths";

// The boundary schemas for the photo lookup. Every adapter (server action, image
// route) parses its raw input through these before anything touches the filesystem.

/**
 * A journal entry's date, `YYYY-MM-DD`.
 *
 * Refined to a real calendar date rather than just the shape, because the whole
 * lookup is string prefix matching -- `2019-06-31` would quietly match nothing and
 * look like an empty archive rather than like bad input.
 */
export const photoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Not a real calendar date.");

/**
 * A path relative to the photo root, as it arrives from a browser.
 *
 * The traversal guard runs HERE as well as in the file store, deliberately: the store
 * refuses an unsafe path, but a request that never gets that far produces a clean 400
 * instead of relying on a downstream `undefined` being handled correctly.
 */
export const photoRelativePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => isSafeRelativePath(value), "Path is outside the photo folder.");

/** What the card sends to look up the folders for one entry's date. */
export const photoFolderLookupSchema = z.object({
  date: photoDateSchema,
});

/** What the card sends to open one folder. */
export const photoFolderContentsSchema = z.object({
  date: photoDateSchema,
  relativePath: photoRelativePathSchema,
  /**
   * Show every photo in the folder instead of only the date's matches.
   *
   * The month-folder escape hatch: when an EXIF scan matches nothing, the card offers
   * "show all photos from June 2019" rather than leaving a dead end. Ignored for a day
   * folder, where every photo already matches.
   */
  includeAll: z.boolean().default(false),
});

export type PhotoFolderLookupInput = z.infer<typeof photoFolderLookupSchema>;
export type PhotoFolderContentsInput = z.infer<typeof photoFolderContentsSchema>;
