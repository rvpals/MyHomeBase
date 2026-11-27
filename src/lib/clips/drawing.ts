// Drawings: a clip image that remembers the strokes it was rasterised from.
//
// The pad draws in the browser and hands over two things — the PNG it rendered and
// the strokes that produced it. The PNG is stored exactly like a pasted screenshot
// (same table, same caps, same serving route); the strokes go in `drawing_json` so
// the pad can reopen it. Migration 0187 records why that is a column, not a table.

import { z } from "zod";
import { decodeImageUpload } from "@/lib/shared/image-upload";
import { ClipIsEncryptedError, ClipNotFoundError, TooManyClipImagesError } from "./clips";
import type { ClipImageProcessor, ClipsRepository } from "./ports";
import { CLIP_IMAGE_MAX_BYTES, CLIP_IMAGE_MAX_EDGE, CLIP_MAX_IMAGES } from "./schema";
import type { Clip, ClipImage } from "./types";

/**
 * The pen colours, as key → colour.
 *
 * ## Why these are literal colours, when the rest of the app forbids them
 *
 * `design.md` forbids a literal colour anywhere **structural**, because structure has
 * to follow the running theme. A drawing is not structure; it is content — a picture
 * someone made, like a pasted photo. It is rasterised once to a PNG on a white sheet,
 * and that PNG has to look the same in all eight themes. An ink resolved from a theme
 * token would bake one theme's idea of "blue" into the bytes, and a light-on-dark ink
 * drawn under a dark theme would vanish on the white sheet.
 *
 * The **keys** are what is stored in each stroke, and they are permanent, like a card
 * colour key: renaming one would make an old drawing reopen with strokes the pad can
 * no longer colour. Changing a value only changes how *future* rasters look.
 */
export const CLIP_DRAWING_INKS = {
  ink: "#1f2328",
  red: "#d93025",
  orange: "#e8710a",
  green: "#188038",
  blue: "#1a73e8",
  purple: "#9334e6",
} as const;

export type ClipDrawingInk = keyof typeof CLIP_DRAWING_INKS;

export const CLIP_DRAWING_INK_KEYS = Object.keys(CLIP_DRAWING_INKS) as [
  ClipDrawingInk,
  ...ClipDrawingInk[],
];

/** The sheet. The eraser paints this, which is why erasing needs no compositing. */
export const CLIP_DRAWING_PAPER = "#ffffff";

/** Pen widths in backing-store pixels, thinnest first. */
export const CLIP_DRAWING_SIZES = [3, 6, 12, 24] as const;

/**
 * The backing store a new drawing gets. 4:3 rather than Pictionary's 3:2: a clip
 * drawing is as often a quick sketch on a phone held upright as a diagram on a desk.
 */
export const CLIP_DRAWING_WIDTH = 1200;
export const CLIP_DRAWING_HEIGHT = 900;

/** Per stroke. A long scribble at pointer-move rate is a few hundred points. */
export const CLIP_DRAWING_MAX_POINTS = 5_000;
/** Per drawing. */
export const CLIP_DRAWING_MAX_STROKES = 2_000;
/**
 * The serialised ceiling, on top of the two counts above. Those bound the shape;
 * this bounds the row, so one drawing can never be a multi-megabyte TEXT column.
 */
export const CLIP_DRAWING_MAX_JSON_LENGTH = 1_000_000;

const coordinate = z.number().int().min(-10_000).max(10_000);

export const clipDrawingStrokeSchema = z.object({
  ink: z.enum(CLIP_DRAWING_INK_KEYS, { message: "That pen colour is not on the palette." }),
  size: z.number().int().min(1).max(100),
  /** Painted in the paper colour rather than `ink`. */
  erase: z.boolean().default(false),
  points: z
    .array(z.tuple([coordinate, coordinate]))
    .min(1, "A stroke needs at least one point.")
    .max(CLIP_DRAWING_MAX_POINTS, "That stroke is too long."),
});

export const clipDrawingSchema = z.object({
  version: z.literal(1),
  width: z.number().int().min(100).max(4000),
  height: z.number().int().min(100).max(4000),
  strokes: z.array(clipDrawingStrokeSchema).max(CLIP_DRAWING_MAX_STROKES, "That drawing has too many strokes."),
});

export type ClipDrawingStroke = z.infer<typeof clipDrawingStrokeSchema>;
export type ClipDrawing = z.infer<typeof clipDrawingSchema>;

/**
 * One save from the pad.
 *
 * `replacesImageId` is set when the reader reopened an existing drawing. The new
 * raster becomes a new row and the old one goes — see `saveClipDrawing`.
 */
export const saveClipDrawingSchema = z.object({
  clipId: z.number().int().positive(),
  /** The PNG the pad rendered, base64 without the `data:` prefix. */
  base64Data: z.string().min(1, "The drawing is empty."),
  drawing: clipDrawingSchema,
  replacesImageId: z.number().int().positive().optional(),
});

export type SaveClipDrawingInput = z.input<typeof saveClipDrawingSchema>;

/** Thrown when `replacesImageId` is not a drawing on this clip. */
export class ClipDrawingNotFoundError extends Error {
  constructor(imageId: number) {
    super(`Drawing ${imageId} was not found on this clip.`);
    this.name = "ClipDrawingNotFoundError";
  }
}

/** The body markup a new drawing is appended as. */
export function clipDrawingImageTag(imageId: number): string {
  return `<p><img src="/api/clips/images/${imageId}" alt="Drawing"></p>`;
}

/**
 * Points every reference to one image at another, leaving everything else alone.
 *
 * Anchored on what follows the id (a quote, `?` or `#`) so image 12 never rewrites
 * a reference to image 123.
 */
export function replaceClipImageReference(html: string, fromId: number, toId: number): string {
  const pattern = new RegExp(`/api/clips/images/${fromId}(?=["'?#])`, "g");
  return html.replace(pattern, `/api/clips/images/${toId}`);
}

export interface SaveClipDrawingResult {
  image: ClipImage;
  /** The clip after its body was pointed at the new image. */
  clip: Clip;
}

/**
 * Stores a drawing on a clip and puts it in the body.
 *
 * - **New drawing:** stores the raster with its strokes and appends an `<img>` to
 *   the body.
 * - **Edited drawing** (`replacesImageId`): stores a **new** row, repoints the body's
 *   `<img>` at it, then deletes the old row. Not an in-place update, because the
 *   image route serves `immutable`: a browser holding the old bytes under the old id
 *   would never ask again, so overwriting them would show a stale drawing forever.
 *
 * Refused on a sealed clip: its body is ciphertext, so there is nowhere to put the
 * `<img>`, and the editor cannot open a sealed clip anyway.
 */
export async function saveClipDrawing(
  repo: ClipsRepository,
  processor: ClipImageProcessor,
  input: SaveClipDrawingInput,
): Promise<SaveClipDrawingResult> {
  const validated = saveClipDrawingSchema.parse(input);
  const drawingJson = JSON.stringify(validated.drawing);
  if (drawingJson.length > CLIP_DRAWING_MAX_JSON_LENGTH) {
    throw new Error("That drawing is too large to save. Clear some of it and try again.");
  }

  const clip = repo.getClipById(validated.clipId);
  if (!clip) throw new ClipNotFoundError(validated.clipId);
  if (clip.isEncrypted) throw new ClipIsEncryptedError();

  const replaced = validated.replacesImageId;
  if (replaced !== undefined) {
    const existing = repo.getClipDrawing(replaced);
    if (!existing || existing.clipId !== clip.id) throw new ClipDrawingNotFoundError(replaced);
  }

  // The row being replaced is about to go, so it does not count against the cap —
  // otherwise a clip at the limit could never have a drawing edited.
  const held = repo.listClipImages(clip.id).filter((image) => image.id !== replaced).length;
  if (held >= CLIP_MAX_IMAGES) throw new TooManyClipImagesError();

  const decoded = decodeImageUpload(
    { mimeType: "image/png", base64Data: validated.base64Data },
    CLIP_IMAGE_MAX_BYTES,
  );
  const prepared = await processor.prepare(decoded, CLIP_IMAGE_MAX_EDGE);
  const image = repo.addClipImage(clip.id, prepared.image, prepared.width, prepared.height, drawingJson);

  const contentHtml =
    replaced === undefined
      ? clip.contentHtml + clipDrawingImageTag(image.id)
      : replaceClipImageReference(clip.contentHtml, replaced, image.id);

  const updated = repo.updateClip(clip.id, {
    title: clip.title,
    contentHtml,
    categories: clip.categories,
    tags: clip.tags,
    color: clip.color,
    createdBy: clip.createdBy,
  });

  if (replaced !== undefined) repo.deleteClipImage(replaced);

  return { image, clip: updated };
}

/**
 * The strokes behind one drawing, for the pad to reopen.
 *
 * Re-validated on the way out rather than trusted: the column is TEXT, and a row
 * hand-edited in the database (or written by a newer build) should fail here with a
 * message, not inside the canvas code.
 */
export function getClipDrawing(repo: ClipsRepository, imageId: number): ClipDrawing {
  const row = repo.getClipDrawing(imageId);
  if (!row) throw new ClipDrawingNotFoundError(imageId);
  return clipDrawingSchema.parse(JSON.parse(row.drawingJson));
}

/** The drawings on one clip, in body order — what the editor offers to reopen. */
export function listClipDrawings(repo: ClipsRepository, clipId: number): ClipImage[] {
  return repo.listClipImages(clipId).filter((image) => image.isDrawing);
}
