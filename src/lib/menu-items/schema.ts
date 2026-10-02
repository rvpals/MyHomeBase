// Boundary validation for the menu item overrides. The web action and the CLI both
// parse their raw input through these, so a bad value is rejected identically in
// both — the litmus test in ARCHITECTURE.md.

import { z } from "zod";

/** How long a retitled menu item may be. */
export const MAX_MENU_ITEM_TITLE_LENGTH = 60;
/** How long its description may be. */
export const MAX_MENU_ITEM_HINT_LENGTH = 200;

/**
 * One override on its way in.
 *
 * `title` is optional-or-absent rather than optional-or-blank: the *absence* of a
 * title means "use the registry's", and the use-case treats a blank string the same
 * way. It is capped because this string renders in the navigation tree, where a
 * 500-character title would break the column rather than wrap.
 *
 * `hint` may be blank — clearing a description to nothing is a legitimate edit, and
 * plenty of items ship without one.
 */
export const menuItemOverrideSchema = z.object({
  /**
   * The icon slot id. Checked for *shape* here and for *existence* in the use-case,
   * which is the only place that can see the registry. Lower snake_case with digits,
   * matching `sectionSlotId`'s output.
   */
  menuItemId: z
    .string()
    .min(1, "Pick a menu item.")
    .regex(/^[a-z0-9_]+$/, "A menu item id is lower snake_case."),
  title: z
    .string()
    .max(MAX_MENU_ITEM_TITLE_LENGTH, `Keep the title to ${MAX_MENU_ITEM_TITLE_LENGTH} characters.`)
    .optional(),
  hint: z
    .string()
    .max(MAX_MENU_ITEM_HINT_LENGTH, `Keep the description to ${MAX_MENU_ITEM_HINT_LENGTH} characters.`)
    .optional(),
});

export type MenuItemOverrideInput = z.infer<typeof menuItemOverrideSchema>;
