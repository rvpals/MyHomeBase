// The zod schemas that validate everything crossing into this module — from a
// server action, from a route handler, or from the CLI. All three parse with the
// same schema, which is what makes a clip created from the terminal identical to
// one created in the browser.

import { z } from "zod";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/shared/image-upload";

/** A clip's title. Optional — an untitled clip is a normal thing to jot. */
export const CLIP_TITLE_MAX_LENGTH = 200;

/**
 * The stored body's ceiling, measured on the **sanitized** HTML.
 *
 * Generous because a pasted email with a table is genuinely large, and because the
 * expensive part — the images — no longer travels inside this string: they are
 * extracted to their own rows first. A clip that still exceeds this after that is
 * pathological rather than normal.
 */
export const CLIP_CONTENT_MAX_LENGTH = 500_000;

/** Per image, on the decoded bytes. Agreed at 5 MB. */
export const CLIP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Per clip. Agreed at 20. */
export const CLIP_MAX_IMAGES = 20;

/**
 * The longest edge an image is resized down to before storage.
 *
 * A phone screenshot pasted at full resolution is several megabytes of pixels no
 * screen in this app ever shows at that size. Resizing on the way in keeps the
 * database small; the original is not kept, which is the trade — a clip is a record
 * of content, not a photo archive. The Picture Gallery is where originals live.
 */
export const CLIP_IMAGE_MAX_EDGE = 1600;

/**
 * Which modules a clip may link into.
 *
 * A fixed enum, not a lookup against `sys_modules` — the reasoning migration 0142
 * records for `MESSAGE_MODULES`. An unknown value fails here, at the boundary, with
 * a readable message, instead of being stored and found later by a join that
 * silently returns nothing.
 */
export const CLIP_LINK_MODULES = ["journal"] as const;

export const clipLinkModuleSchema = z.enum(CLIP_LINK_MODULES, {
  message: "That module cannot have clips linked to it.",
});

/**
 * A name in the category or tag lists.
 *
 * Trimmed before the length check so "   " is empty rather than three characters,
 * and capped well under the column width so a name is always renderable as a chip.
 */
const taxonomyNameSchema = z
  .string()
  .trim()
  .min(1, "Give it a name.")
  .max(60, "Keep the name under 60 characters.");

/** Creating a clip. Everything but the body is optional. */
export const createClipSchema = z.object({
  title: z.string().trim().max(CLIP_TITLE_MAX_LENGTH, "That title is too long.").default(""),
  /**
   * Raw markup as pasted. **Sanitized by the use-case, not here** — zod validates
   * shape and size, and `sanitizeClipHtml` decides what survives. Keeping those
   * separate means the sanitizer is testable on its own and the schema stays a
   * boundary check rather than a security control.
   */
  contentHtml: z
    .string()
    .max(CLIP_CONTENT_MAX_LENGTH, "That clip is too large to store.")
    .default(""),
  categories: z.array(taxonomyNameSchema).default([]),
  tags: z.array(taxonomyNameSchema).default([]),
});

export type CreateClipInput = z.infer<typeof createClipSchema>;

/** Updating a clip. Same shape plus the id; a full replace, not a patch. */
export const updateClipSchema = createClipSchema.extend({
  id: z.number().int().positive(),
});

export type UpdateClipInput = z.infer<typeof updateClipSchema>;

/**
 * Sealing a clip.
 *
 * The hint is stored **in the clear** — that is what makes it readable before
 * decryption and also what makes it dangerous, so the schema refuses the obvious
 * mistake of putting the password in it. It cannot catch a paraphrase; the UI says
 * so in words as well.
 */
export const encryptClipSchema = z
  .object({
    id: z.number().int().positive(),
    password: z.string().min(1, "A password is required."),
    passwordHint: z.string().trim().max(200, "Keep the hint short.").default(""),
  })
  .refine(
    (value) =>
      value.passwordHint === "" ||
      !value.passwordHint.toLowerCase().includes(value.password.toLowerCase()),
    { message: "The hint must not contain the password.", path: ["passwordHint"] },
  );

export type EncryptClipInput = z.infer<typeof encryptClipSchema>;

/** Opening a sealed clip, or unsealing it permanently. */
export const clipPasswordSchema = z.object({
  id: z.number().int().positive(),
  password: z.string().min(1, "A password is required."),
});

export type ClipPasswordInput = z.infer<typeof clipPasswordSchema>;

/**
 * One image on its way into a clip.
 *
 * Reuses the app-wide upload shape so the allowlist cannot drift per module — the
 * same reasoning `shared/image-upload.ts` gives for existing there at all. SVG is
 * excluded there and stays excluded here: these bytes are served from this app's
 * own origin, so an SVG would be stored XSS.
 */
export const clipImageUploadSchema = z.object({
  mimeType: z.enum(IMAGE_UPLOAD_MIME_TYPES, { message: "Use a PNG, JPEG, WebP or GIF image." }),
  base64Data: z.string().min(1, "The image is empty."),
});

export type ClipImageUploadInput = z.infer<typeof clipImageUploadSchema>;

/** Attaching a clip to a record in another module. */
export const linkClipSchema = z.object({
  clipId: z.number().int().positive(),
  targetModule: clipLinkModuleSchema,
  targetId: z.number().int().positive(),
});

export type LinkClipInput = z.infer<typeof linkClipSchema>;

/** Detaching one link, by its own id. */
export const unlinkClipSchema = z.object({
  linkId: z.number().int().positive(),
});

export type UnlinkClipInput = z.infer<typeof unlinkClipSchema>;

/**
 * Filtering the clip list.
 *
 * Every field is optional and the empty object is valid — that is the unfiltered
 * list. Category and tag filters are AND within a kind and across kinds: picking
 * two tags means clips carrying both, which is what a reader narrowing a list
 * expects.
 */
export const clipFilterSchema = z.object({
  search: z.string().trim().default(""),
  categories: z.array(taxonomyNameSchema).default([]),
  tags: z.array(taxonomyNameSchema).default([]),
  /** Restrict to clips linked to one record. Used by the journal's badge. */
  targetModule: clipLinkModuleSchema.optional(),
  targetId: z.number().int().positive().optional(),
});

export type ClipFilterInput = z.infer<typeof clipFilterSchema>;

/** Creating or renaming a category/tag. */
export const clipTaxonomySchema = z.object({
  name: taxonomyNameSchema,
  description: z.string().trim().max(500, "Keep the description under 500 characters.").default(""),
});

export type ClipTaxonomyInput = z.infer<typeof clipTaxonomySchema>;
