// The boundary validation for an icon-override upload. Both the web action and any
// future CLI command parse through these, so neither can write a row the other
// wouldn't accept.

import { z } from "zod";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/shared/image-upload";

/**
 * An icon is a small file. 256 KB is generous for a glyph — the largest built-in
 * baked body is a few KB — and the cap exists because these bytes are read on every
 * page render, not just when the icon is shown.
 */
export const ICON_OVERRIDE_MAX_BYTES = 256 * 1024;

/** SVG arrives as text, not base64: it is sanitized as markup before it is stored. */
export const svgOverrideSchema = z.object({
  slotId: z.string().min(1, "Pick an icon position."),
  setId: z.string().min(1, "Pick an icon set."),
  kind: z.literal("svg"),
  /** The raw file contents, straight from the upload. */
  source: z
    .string()
    .min(1, "That SVG file is empty.")
    .max(ICON_OVERRIDE_MAX_BYTES, "That SVG is too large — keep it under 256 KB."),
});

export const rasterOverrideSchema = z.object({
  slotId: z.string().min(1, "Pick an icon position."),
  setId: z.string().min(1, "Pick an icon set."),
  kind: z.literal("raster"),
  mimeType: z.enum(IMAGE_UPLOAD_MIME_TYPES, {
    message: "Use an SVG, PNG, JPEG, WebP or GIF image.",
  }),
  base64Data: z.string().min(1, "That image is empty."),
});

/**
 * Discriminated on `kind` so the two payloads can't be mixed — a row carrying both a
 * sanitized body and raster bytes would be ambiguous to render, which is why the table
 * also CHECK-constrains it.
 */
export const iconOverrideInputSchema = z.discriminatedUnion("kind", [
  svgOverrideSchema,
  rasterOverrideSchema,
]);

export type IconOverrideInput = z.infer<typeof iconOverrideInputSchema>;

export const clearIconOverrideSchema = z.object({
  slotId: z.string().min(1),
  setId: z.string().min(1),
});

export type ClearIconOverrideInput = z.infer<typeof clearIconOverrideSchema>;
