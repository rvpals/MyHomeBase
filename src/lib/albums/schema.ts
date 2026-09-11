import { z } from "zod";
import { photoRelativePathSchema } from "@/lib/journal-photos";

// The boundary schemas for albums. Every adapter (server action, CLI command) parses
// its raw input through these before anything reaches the table.

/**
 * The most photographs one album may hold.
 *
 * Not a storage limit — rows are cheap. It is a limit on what the screens behind this
 * can honestly do: the detail view renders every photo's thumbnail, the slideshow holds
 * the whole set in memory, and the export reads them one at a time off an SMB share.
 * 2,000 is far past any real album and still small enough that none of those three
 * degrade into something that looks broken.
 */
export const MAX_ALBUM_PHOTOS = 2000;

/**
 * An album's name.
 *
 * Trimmed and non-empty: a blank name gives the list a row with nothing to click and
 * the `+` menu an invisible entry. 120 characters is a title, not a description — the
 * cap exists because this renders in a nav-width column and a pasted paragraph would
 * break the layout, the same argument `favPhotoNoteSchema` makes for its 500.
 *
 * Uniqueness is NOT checked here. A schema validates a shape; whether a name is taken
 * is a question about stored state, so it belongs to the use-case (which can report
 * *which* album has it) and to the unique index (which makes the answer true under a
 * race). Putting it here would need the schema to reach a database.
 */
export const albumNameSchema = z.string().trim().min(1).max(120);

/**
 * An album's description. Blank rather than absent when nothing was written.
 *
 * `.default("")` so the create form can omit it entirely — per `coding-guide.md`, a
 * value that means "nothing set" stores the empty string, never NULL.
 */
export const albumDescriptionSchema = z.string().trim().max(2000).default("");

/**
 * A path being put into an album.
 *
 * Reuses the photo archive's own path schema rather than declaring a second one, so a
 * path this module stores is by construction a path the image route will serve — the
 * same reasoning, and the same schema, as `favPhotoPathSchema`. Its `isSafeRelativePath`
 * refinement is also the security boundary: a traversal like `../../etc/passwd` is
 * rejected here, so a crafted membership row can never coax the image route or the zip
 * export into reading outside the archive.
 */
export const albumPhotoPathSchema = photoRelativePathSchema;

/** An album's id, as it arrives from a form field or an argv string. */
export const albumIdSchema = z.coerce.number().int().positive();

/** What the "New album" form sends. */
export const albumCreateSchema = z.object({
  name: albumNameSchema,
  description: albumDescriptionSchema,
});

/** What the rename/describe form sends. */
export const albumUpdateSchema = z.object({
  id: albumIdSchema,
  name: albumNameSchema,
  description: albumDescriptionSchema,
});

/**
 * What "add these photos to this album" sends.
 *
 * `.min(1)` because an empty add is a caller bug rather than a no-op worth absorbing —
 * the screens all have something selected before the control is reachable.
 */
export const albumPhotosSchema = z.object({
  albumId: albumIdSchema,
  relativePaths: z.array(albumPhotoPathSchema).min(1).max(MAX_ALBUM_PHOTOS),
});

/** What a drag-reorder sends: the album's full membership in its new order. */
export const albumOrderSchema = z.object({
  albumId: albumIdSchema,
  relativePaths: z.array(albumPhotoPathSchema).max(MAX_ALBUM_PHOTOS),
});

export type AlbumCreateInput = z.infer<typeof albumCreateSchema>;
export type AlbumUpdateInput = z.infer<typeof albumUpdateSchema>;
export type AlbumPhotosInput = z.infer<typeof albumPhotosSchema>;
export type AlbumOrderInput = z.infer<typeof albumOrderSchema>;
