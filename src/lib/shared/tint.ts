// The reader-chosen colour palette, shared by every record that can wear one.
//
// First used by Clips (a card's tint, `clp_clips.card_color`), then by Journal
// categories (the calendar's entry dots, `jrn_categories.color`, migration 0172).
// One list, so a "rose" clip and a "rose" category are the same rose.
//
// **These keys are permanent.** They are written into rows, so renaming one
// silently blanks every record that used it back to the default — the same
// asymmetry coding-guide.md records for icon slot ids. Adding a key is cheap
// (plus its `.clip-tint-<key>` hue class in globals.css); changing one is not.
//
// Each key names a hue, never stores one. The hue lives in globals.css and is
// mixed into the running theme's tokens at render — design.md → "Tinted surfaces".

import { z } from "zod";

export const TINT_COLORS = ["rose", "amber", "sage", "ocean", "indigo", "slate"] as const;

export type TintColor = (typeof TINT_COLORS)[number];

/** A tint key, or `""` for "no colour". Blank, never a sentinel. */
export const tintColorSchema = z.union([z.literal(""), z.enum(TINT_COLORS)]).default("");

/** Narrows a stored string to a tint key, reading anything unknown as "no colour". */
export function toTintColor(value: string | null | undefined): TintColor | "" {
  return value !== null && value !== undefined && (TINT_COLORS as readonly string[]).includes(value)
    ? (value as TintColor)
    : "";
}
