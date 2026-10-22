import { z } from "zod";
import { isSafeRelativePath } from "../journal-photos";
import { MAX_CULL_CEILING } from "./config";

// The boundary schema for a culling request. The server action parses its raw input
// through this before anything touches the filesystem -- the same arrangement the
// journal's photo lookups use.

/**
 * One file name, as it arrives from a browser.
 *
 * A NAME, never a path: the folder is validated separately and the two are joined
 * server-side, so a separator here would let a caller address a different folder
 * through the file list. Rejected rather than stripped, because a stripped name would
 * silently read the wrong file.
 */
const photoNameSchema = z
  .string()
  .min(1, "A photo name cannot be empty.")
  .max(255, "That photo name is too long.")
  .refine((value) => !value.includes("/") && !value.includes("\\"), "A photo name cannot contain a path.")
  .refine((value) => !value.includes("\0"), "A photo name cannot contain a NUL byte.")
  .refine((value) => value !== "." && value !== "..", "Not a photo name.");

/**
 * What the culling action accepts: which folder, and which of its photos to score.
 *
 * The photo list is required rather than optional. The dialog has already filtered a
 * month folder down to one day's pictures, and letting the request omit the list would
 * make the easiest call the most expensive one -- culling the whole month to answer a
 * question about twelve photographs.
 */
export const cullRequestSchema = z.object({
  folder: z
    .string()
    .min(1, "A folder is required.")
    .refine(isSafeRelativePath, "Not a safe archive-relative folder."),
  names: z
    .array(photoNameSchema)
    .min(1, "Select at least one photo to cull.")
    // The ABSOLUTE ceiling, not the configured one. The stored setting may raise the
    // limit above the built-in default, so validating against that default here would
    // reject a request the use-case would have accepted. This is the guard against an
    // unbounded array arriving from a browser; the real, tunable limit is applied in
    // `cullFolder`, which reads the setting.
    .max(MAX_CULL_CEILING, `Cannot cull more than ${MAX_CULL_CEILING} photos at once.`),
});

export type CullRequestInput = z.infer<typeof cullRequestSchema>;
