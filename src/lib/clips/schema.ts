// The zod schemas that validate everything crossing into this module — from a
// server action, from a route handler, or from the CLI. All three parse with the
// same schema, which is what makes a clip created from the terminal identical to
// one created in the browser.

import { z } from "zod";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/shared/image-upload";
import { CLIP_EXCERPT_LENGTH } from "./sanitize-html";

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
 * The card tints a clip may wear.
 *
 * **These keys are permanent.** They are written into `clp_clips.card_color` on every
 * coloured clip, so renaming one silently blanks those cards back to the default —
 * the same asymmetry `coding-guide.md` records for icon slot ids. Adding a key is
 * cheap; changing one is not.
 *
 * `""` is the default surface and is deliberately the empty string rather than a
 * `"default"` member: blank, never a sentinel, matching how every other optional text
 * column in this module stores "nothing chosen".
 *
 * Each key names a *role*, not a hex. The tint is built from the running theme's own
 * tokens in `globals.css` — see `Clip.color` for why a stored hex would be wrong in
 * eight themes at once.
 */
export const CLIP_CARD_COLORS = [
  "rose",
  "amber",
  "sage",
  "ocean",
  "indigo",
  "slate",
] as const;

export type ClipCardColor = (typeof CLIP_CARD_COLORS)[number];

/** A card tint, or `""` for the default surface. */
export const clipCardColorSchema = z
  .union([z.literal(""), z.enum(CLIP_CARD_COLORS)])
  .default("");

/**
 * One checklist line.
 *
 * Trimmed before the length check so "   " is empty rather than three characters —
 * the same treatment `taxonomyNameSchema` gets, and for the same reason: whitespace
 * is not content.
 */
export const CLIP_ITEM_MAX_LENGTH = 500;

const clipItemTextSchema = z
  .string()
  .trim()
  .min(1, "An item needs some text.")
  .max(CLIP_ITEM_MAX_LENGTH, "Keep an item under 500 characters.");

/**
 * Per clip. Generous, because a packing list is a normal thing to keep here, but
 * bounded — the items ride on every summary in the list (see `ClipSummary.items`),
 * so an unbounded checklist would be an unbounded page.
 */
export const CLIP_MAX_ITEMS = 200;

/**
 * A clip's checklist as the editor saves it: the whole list, in order.
 *
 * A full replace rather than a patch, matching `updateClipSchema` — the editor owns
 * the arrangement, and diffing item-by-item across a drag-reorder would be a second
 * way to write the same rows.
 */
export const saveClipItemsSchema = z.object({
  clipId: z.number().int().positive(),
  items: z
    .array(
      z.object({
        /** Absent for a line the reader just typed; present when it already exists. */
        id: z.number().int().positive().optional(),
        text: clipItemTextSchema,
        isDone: z.boolean().default(false),
      }),
    )
    .max(CLIP_MAX_ITEMS, `A clip can hold at most ${CLIP_MAX_ITEMS} items.`)
    .default([]),
});

export type SaveClipItemsInput = z.input<typeof saveClipItemsSchema>;

/**
 * Ticking one item.
 *
 * Its own schema rather than a reuse of the save above, because it is a genuinely
 * different operation: one row, one column, no reordering — and it is the one write
 * here that happens on a plain click rather than a deliberate save.
 */
export const toggleClipItemSchema = z.object({
  itemId: z.number().int().positive(),
  isDone: z.boolean(),
});

export type ToggleClipItemInput = z.infer<typeof toggleClipItemSchema>;

/** Pinning or unpinning a clip. */
export const pinClipSchema = z.object({
  id: z.number().int().positive(),
  isPinned: z.boolean(),
});

export type PinClipInput = z.infer<typeof pinClipSchema>;

/** Recolouring a clip. */
export const setClipColorSchema = z.object({
  id: z.number().int().positive(),
  color: clipCardColorSchema,
});

export type SetClipColorInput = z.infer<typeof setClipColorSchema>;

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

/**
 * A list of names *attached to something* — a clip's categories, a filter's tags.
 *
 * Blanks are **dropped, not rejected**, which is the difference between this and
 * `taxonomyNameSchema` on its own. The two look alike and mean different things:
 *
 * - Naming a category on the Categories & Tags screen is a deliberate act, so an
 *   empty name there is a mistake worth refusing — that is `clipTaxonomySchema`.
 * - A clip's own list arrives from a chip picker, where an empty entry is a reader
 *   who opened a box and typed nothing. Refusing the whole save over it would be
 *   telling them off for something they did not do.
 *
 * `normaliseNames` in the use-case already drops blanks for exactly this reason; it
 * simply never got the chance, because the schema rejected the array first. Filtering
 * here puts the decision at the boundary where the rest of the shape is decided, and
 * leaves `normaliseNames` to do the de-duplication it is really for.
 */
const clipTaxonomyListSchema = z
  .array(z.string())
  .default([])
  .transform((names) => names.filter((name) => name.trim() !== ""))
  .pipe(z.array(taxonomyNameSchema));

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
  categories: clipTaxonomyListSchema,
  tags: clipTaxonomyListSchema,
  /** The card tint. Chosen while writing, changed later from the card itself. */
  color: clipCardColorSchema,
});

/**
 * What a **caller** passes to create a clip.
 *
 * `z.input`, not `z.infer`. Every field here has a `.default()`, so the parsed
 * *output* has them all present while the input legitimately omits them — and
 * `z.infer` is the output type. Using it would oblige all ~30 call sites and tests
 * to pass a `color` they do not care about, to a schema whose whole job is to fill it
 * in. The use-case parses, so what it accepts is the input type.
 */
export type CreateClipInput = z.input<typeof createClipSchema>;

/** Updating a clip. Same shape plus the id; a full replace, not a patch. */
export const updateClipSchema = createClipSchema.extend({
  id: z.number().int().positive(),
});

export type UpdateClipInput = z.input<typeof updateClipSchema>;

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
  categories: clipTaxonomyListSchema,
  tags: clipTaxonomyListSchema,
  /** Restrict to clips linked to one record. Used by the journal's badge. */
  targetModule: clipLinkModuleSchema.optional(),
  targetId: z.number().int().positive().optional(),
  /**
   * How much of each clip's text to return, in characters.
   *
   * Part of the *filter* rather than a separate argument because it changes the
   * shape of the rows the repository reads — it is bounded into the `substr` that
   * keeps a pasted email's bytes inside SQLite. A caller that does not care gets
   * the default; the board and the list pass the reader's configured length.
   */
  excerptChars: z.number().int().positive().default(CLIP_EXCERPT_LENGTH),
});

export type ClipFilterInput = z.infer<typeof clipFilterSchema>;

/** Creating or renaming a category/tag. */
export const clipTaxonomySchema = z.object({
  name: taxonomyNameSchema,
  description: z.string().trim().max(500, "Keep the description under 500 characters.").default(""),
});

export type ClipTaxonomyInput = z.infer<typeof clipTaxonomySchema>;
