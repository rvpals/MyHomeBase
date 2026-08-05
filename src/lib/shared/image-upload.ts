// Pure — no I/O. One definition of "an image a user uploaded", shared by every
// module that stores image bytes in a BLOB column (expense card art, expense
// category icons, investment-account icons).
//
// Promoted out of lib/expense when a second module needed it. The allowlist and
// the decode rules must not drift per module: they're the boundary that stops a
// hostile or oversized file reaching a DB column and then being served back from
// this app's own origin.

import { z } from "zod";

/**
 * What an uploaded image may be.
 *
 * SVG is excluded on purpose: it can carry script, and these bytes are served
 * from the app's own origin, so an SVG icon would be a stored-XSS vector.
 */
export const IMAGE_UPLOAD_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export type ImageUploadMimeType = (typeof IMAGE_UPLOAD_MIME_TYPES)[number];

/** One image on its way in from a browser. The size cap belongs to the caller. */
export const imageUploadSchema = z.object({
  mimeType: z.enum(IMAGE_UPLOAD_MIME_TYPES, {
    message: "Use a PNG, JPEG, WebP or GIF image.",
  }),
  /** Base64 of the file, as read in the browser. */
  base64Data: z.string().min(1, "The image is empty."),
});

export type ImageUploadInput = z.infer<typeof imageUploadSchema>;

/** Decoded bytes plus the type to serve them back as. */
export interface DecodedImage {
  data: Buffer;
  mimeType: string;
}

/**
 * Decodes a base64 upload into bytes, refusing anything that isn't an allowed
 * image type or that busts the caller's size cap. The cap is a parameter because
 * a full-bleed card image and a 20px icon deserve very different limits.
 *
 * The cap is checked against the *decoded* length, not the base64 string, which is
 * ~33% longer — checking the string would silently reject files a third under the
 * stated limit.
 */
export function decodeImageUpload(input: ImageUploadInput, maxBytes: number): DecodedImage {
  const { mimeType, base64Data } = imageUploadSchema.parse(input);

  const data = Buffer.from(base64Data, "base64");
  if (data.length === 0) throw new Error("The image could not be read.");
  if (data.length > maxBytes) {
    throw new Error(`Image is too large — keep it under ${Math.round(maxBytes / 1024)} KB.`);
  }

  return { data, mimeType };
}
