import { z } from "zod";
import { MAX_SHORTCUTS_PER_USER } from "./types";

/** Nothing useful fits in fewer, and a tile cannot show more. */
const NAME_MAX = 40;

/**
 * The protocols a URL shortcut may use.
 *
 * An allowlist, not a blocklist, and that direction is the point. A shortcut's
 * href is written into an anchor the reader clicks, so `javascript:` would be a
 * stored self-XSS: whatever one person saved would run in their own session on
 * every home-screen visit. `data:` and `vbscript:` are the same hazard wearing
 * different hats, and blocking the three of them by name would still miss the
 * fourth. Allowing exactly http and https can't.
 */
const ALLOWED_PROTOCOLS = ["http:", "https:"];

/**
 * A web address, normalised and checked.
 *
 * Bare hosts are accepted and given a protocol — someone typing `example.com`
 * into a box labelled "link" means `https://example.com`, and rejecting it
 * would be pedantry. The protocol is prepended *before* parsing rather than
 * after, so the allowlist below sees the final string and there is no gap
 * between what was validated and what gets stored.
 */
export const shortcutUrlSchema = z
  .string()
  .trim()
  .min(1, "Enter a web address.")
  .max(2000, "That web address is too long.")
  .transform((raw) => (/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`))
  .superRefine((value, ctx) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "That isn't a valid web address." });
      return;
    }
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A shortcut can only link to an http:// or https:// address.",
      });
    }
  });

export const shortcutNameSchema = z
  .string()
  .trim()
  .min(1, "Give the shortcut a name.")
  .max(NAME_MAX, `A name can be at most ${NAME_MAX} characters.`);

/**
 * A glyph concept name.
 *
 * Deliberately **not** an enum of `TREE_ICONS` keys. `src/lib/` may not import a
 * React component, and `TREE_ICONS` lives in one — so the closed list the picker
 * offers is enforced where the picker is, and this schema checks only the shape.
 * A concept that stops existing falls back at render time rather than making the
 * row unreadable, so tolerance here is the correct behaviour and not a gap.
 */
export const shortcutIconSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9-]+$/, "That isn't a valid icon name.");

/**
 * One shortcut as a form submits it.
 *
 * A discriminated union on `kind`, so the fields that must be present are the
 * ones the chosen kind actually uses: a URL shortcut with a `moduleSlug` is not
 * a URL shortcut with a stray field, it is a bug in the caller. The two branches
 * each fill in the other's columns as `""`, which is what the table stores and
 * saves every reader a null check.
 */
export const shortcutDraftSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("url"),
    name: shortcutNameSchema,
    icon: shortcutIconSchema,
    url: shortcutUrlSchema,
  }),
  z.object({
    kind: z.literal("section"),
    name: shortcutNameSchema,
    icon: shortcutIconSchema,
    /** The module the target lives in. Always present — a section without one is unresolvable. */
    moduleSlug: z
      .string()
      .trim()
      .min(1, "Choose a module.")
      .max(60),
    /**
     * The section within it, or `""` for the module root.
     *
     * Optional-with-a-default rather than required: "shortcut to Journal" is a
     * legitimate choice, and it is spelled as an absent section.
     */
    sectionId: z.string().trim().max(60).default(""),
  }),
]);

export type ShortcutDraftInput = z.input<typeof shortcutDraftSchema>;
export type ShortcutDraftParsed = z.output<typeof shortcutDraftSchema>;

/**
 * The ids of one person's shortcuts in their new order.
 *
 * Takes the whole list rather than a single moved id, so the card can never be
 * left half-reordered — the same call `reorderCategoriesSchema` makes for the
 * scratchpad's tabs.
 */
export const reorderShortcutsSchema = z
  .array(z.number().int().positive())
  .max(MAX_SHORTCUTS_PER_USER)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "A shortcut is listed more than once.",
  });

export type ReorderShortcutsInput = z.infer<typeof reorderShortcutsSchema>;
