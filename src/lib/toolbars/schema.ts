// Boundary validation for toolbars. The admin form and the CLI both parse through
// these, so a bad colour or a destination-less shortcut is rejected identically in
// both.

import { z } from "zod";
import { isOrnamentalKind, TOOLBAR_EDGES, TOOLBAR_ITEM_KINDS } from "./types";

export const MAX_TOOLBAR_NAME_LENGTH = 40;
export const MAX_TOOLBAR_LABEL_LENGTH = 40;

/**
 * A CSS color, restricted to the forms we are willing to write into a `style`
 * attribute: `#rgb`, `#rrggbb`, `#rrggbbaa`, and the `rgb()`/`hsl()` functions.
 *
 * An allowlist rather than "any string", because this value is interpolated into
 * inline styles. A bare allowance of arbitrary text would let `url(...)` or a
 * CSS-variable reference in, which is a way to pull in an external resource or to
 * read a token the admin was not choosing. Named colors are deliberately excluded:
 * the picker emits hex, and allowing `red` would mean also deciding about
 * `currentColor` and `inherit`.
 */
const cssColor = z
  .string()
  .trim()
  .regex(
    /^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|(rgb|hsl)a?\([0-9.,%\s/]+\))$/,
    "Use a hex colour like #2f6f4f, or an rgb()/hsl() value.",
  );

/**
 * An optional color: absent, or a valid one.
 *
 * A blank string becomes `undefined` rather than failing, because that is what a
 * cleared color input posts and "no colour" is a real choice — it means inherit the
 * app's own surface, which is the default.
 */
const optionalColor = z
  .union([cssColor, z.literal("")])
  .optional()
  .transform((value) => (value ? value : undefined));

/**
 * The library picture this bar draws, or absent for none.
 *
 * Not checked against the library here: this schema validates *shape*, and
 * whether a picture still exists is a question only a repository can answer. A
 * stale id is a legitimate stored state by design (migration 0130), so rejecting
 * one at the boundary would make a toolbar un-saveable because of an unrelated
 * delete. `resolveToolbar` drops a pointer that no longer resolves.
 *
 * A blank string becomes `undefined` for the same reason the colours do — that is
 * what a cleared `<select>` posts, and "no texture" is the default state.
 */
const optionalTextureId = z
  .union([
    z
      .number({ message: "A texture id must be a number." })
      .int("A texture id must be a whole number.")
      .positive("A texture id must be positive."),
    z.literal(""),
  ])
  .optional()
  .transform((value) => (value === "" ? undefined : value));

export const toolbarSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the toolbar a name.")
    .max(MAX_TOOLBAR_NAME_LENGTH, `Keep the name to ${MAX_TOOLBAR_NAME_LENGTH} characters.`),
  backgroundColor: optionalColor,
  borderColor: optionalColor,
  textColor: optionalColor,
  textureId: optionalTextureId,
  // The same 0..1 bounds the table CHECKs, restated because the CHECK reports a
  // SQLite error and this reports something the editor can show — the split 0064
  // documents for the module texture knobs. `.default()` rather than required:
  // every caller that does not care about textures (the CLI, an older form post)
  // gets the table's own default without having to name it.
  textureOpacity: z
    .number({ message: "Opacity must be a number." })
    .min(0, "Opacity cannot be negative.")
    .max(1, "Opacity cannot exceed 1.")
    .default(0.15),
  // `TOOLBAR_EDGES` is a `const` tuple, so this infers the literal union rather
  // than `string` — which is what keeps `ToolbarInput` assignable to `ToolbarWrite`
  // with no cast. See the constant's own note.
  edge: z.enum(TOOLBAR_EDGES),
  fullModeOnly: z.boolean(),
  isVisible: z.boolean(),
});

/**
 * What a **caller** passes in — the schema's input side, not its output.
 *
 * `z.input` and not `z.infer`, and the difference is load-bearing here: the colour
 * fields run through a `.transform()`, which makes their *output* type
 * `string | undefined` as a **required** key. `z.infer` would therefore force every
 * caller to pass all three colours explicitly, even to leave them unset — which is
 * the common case. `z.input` keeps them genuinely optional, which is what a form
 * and a CLI flag actually produce.
 */
export type ToolbarInput = z.input<typeof toolbarSchema>;

/** What the schema produces — colours already normalised to `string | undefined`. */
export type ParsedToolbar = z.output<typeof toolbarSchema>;

/**
 * One row on the way in.
 *
 * The cross-field rules are what this schema is for, and they are the ones a form
 * gets wrong: a `menu-item` row without a destination is a button that goes
 * nowhere, and the ornamental kinds (`separator`, `spacer`) carry neither a label
 * nor a destination and are rejected if given either. So a row's kind fully
 * determines its shape.
 */
export const toolbarItemSchema = z
  .object({
    kind: z.enum(TOOLBAR_ITEM_KINDS),
    menuItemId: z.string().trim().optional(),
    label: z
      .string()
      .trim()
      .max(MAX_TOOLBAR_LABEL_LENGTH, `Keep the label to ${MAX_TOOLBAR_LABEL_LENGTH} characters.`)
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "menu-item" && !value.menuItemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["menuItemId"],
        message: "Pick the screen this item opens.",
      });
    }
    if (isOrnamentalKind(value.kind) && (value.menuItemId || value.label)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["kind"],
        message:
          value.kind === "separator"
            ? "A separator carries no label and no destination."
            : "A spacer carries no label and no destination.",
      });
    }
  });

/**
 * What a caller passes in. `z.input` for the same reason as `ToolbarInput`, though
 * this schema only `.superRefine()`s — which does not change the type — so the two
 * sides happen to agree today. Kept symmetrical so adding a transform later cannot
 * quietly make every call site require a field it does not have.
 */
export type ToolbarItemInput = z.input<typeof toolbarItemSchema>;
