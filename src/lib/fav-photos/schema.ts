import { z } from "zod";
import { photoRelativePathSchema } from "@/lib/journal-photos";

// The boundary schemas for favouriting a photograph. Every adapter (server action,
// CLI command) parses its raw input through these before anything reaches the table.

/**
 * The photo being favourited.
 *
 * Reuses the photo archive's own path schema rather than declaring a second one, so a
 * path this module will store is by construction a path the image route will serve.
 * Two independent limits would eventually drift into a favourite that cannot be
 * displayed — the same argument `favoriteTickerSchema` makes for matching
 * `TICKER_PATTERN`.
 *
 * That schema's refinement (`isSafeRelativePath`) also does the security work: a
 * traversal like `../../etc/passwd` is rejected here, so a crafted favourite cannot
 * become a row that later coaxes the image route into serving something outside the
 * archive.
 */
export const favPhotoPathSchema = photoRelativePathSchema;

/**
 * A note on a favourite.
 *
 * Optional and defaulted, because the heart does not prompt — the common path stores
 * `""` and the note is written later, from the list. Trimmed so trailing whitespace
 * from a textarea cannot make an empty note look present.
 *
 * 500 characters: a caption, not an essay. The cap exists because this is stored and
 * rendered in a table cell; without one, a paste of a whole document becomes a row
 * that breaks the list's layout.
 */
export const favPhotoNoteSchema = z.string().trim().max(500).default("");

/** What the heart sends: a path, and a note only if one was somehow supplied. */
export const favPhotoSchema = z.object({
  relativePath: favPhotoPathSchema,
  note: favPhotoNoteSchema,
});

/** What the list's inline note editor sends. */
export const favPhotoNoteInputSchema = z.object({
  relativePath: favPhotoPathSchema,
  note: favPhotoNoteSchema,
});

export type FavPhotoInput = z.infer<typeof favPhotoSchema>;
export type FavPhotoNoteInput = z.infer<typeof favPhotoNoteInputSchema>;
