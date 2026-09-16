import { z } from "zod";

/**
 * How many notes one person may keep in one category.
 *
 * A cap, not a preference. The scratchpad is a floating component people leave open, and
 * "New note" is one click — so an uncapped tab grows without bound from ordinary use and
 * the list stops being navigable long before the database notices. 200 is far more than
 * anyone scrolls through and keeps the per-tab read trivial.
 *
 * Unlike the calculator's `HISTORY_LIMIT`, this is **not** enforced by pruning on
 * insert. A tape is a rolling record where losing the oldest line is the intended
 * behaviour; a note is something someone wrote deliberately, so silently deleting their
 * oldest one to make room for a new one would be data loss. The cap is enforced by
 * *refusing the create* instead — see `createNote`.
 */
export const NOTES_PER_CATEGORY_LIMIT = 200;

/**
 * How many categories the household may have.
 *
 * The real constraint is the tab strip: past a dozen or so, tabs stop being a usable
 * control at any width, and on a phone they are already scrolling. 40 is a generous
 * ceiling that still stops a script from making the window unrenderable.
 */
export const CATEGORY_LIMIT = 40;

/** The longest a note's body may be, in characters. */
export const NOTE_BODY_LIMIT = 20000;

/**
 * A category name.
 *
 * Trimmed before validation, so " Work " and "Work" are the same name and a trailing
 * space can't smuggle past the case-insensitive uniqueness check. 40 characters is what
 * fits in a tab; the check is here rather than in CSS because a name that doesn't fit
 * breaks the strip for everyone, not just the person who typed it.
 *
 * Newlines are rejected outright: a tab label is one line by definition, and a pasted
 * multi-line string would otherwise render as a tab of unbounded height.
 */
export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, "A category needs a name.")
  .max(40, "That category name is too long.")
  .refine((name) => !/[\r\n]/.test(name), "A category name has to be a single line.");

/** Creating a category. The position is assigned by the use-case, not supplied. */
export const createCategorySchema = z.object({
  name: categoryNameSchema,
});

/** Renaming a category. */
export const renameCategorySchema = z.object({
  id: z.number().int().positive(),
  name: categoryNameSchema,
});

/**
 * Reordering the whole strip: every category id, in the order they should appear.
 *
 * The **whole** list rather than one id and a direction, deliberately. A drag-and-drop
 * or move-up/move-down control produces a new order, and applying it as one write means
 * the strip can never be left half-reordered by a failed second call. The use-case
 * checks the list against what exists rather than trusting it.
 */
export const reorderCategoriesSchema = z.object({
  ids: z.array(z.number().int().positive()).max(CATEGORY_LIMIT),
});

/** Deleting a category. Refused while notes are filed under it — see `deleteCategory`. */
export const deleteCategorySchema = z.object({
  id: z.number().int().positive(),
});

/**
 * A note's title.
 *
 * Blank is valid and is the ordinary case — a reader opens the window and types without
 * naming anything. Single-line for the same reason a category name is: it is a label in
 * a list.
 */
export const noteTitleSchema = z
  .string()
  .trim()
  .max(120, "That title is too long.")
  .refine((title) => !/[\r\n]/.test(title), "A title has to be a single line.");

/**
 * A note's body.
 *
 * **Not trimmed.** This is the one string in the module that keeps its whitespace, and
 * that is deliberate: a scratchpad is where people paste indented text and leave a blank
 * line between thoughts, and autosave firing mid-typing must not quietly reformat what
 * is on screen. Trimming would also mean a reader who typed two newlines and paused
 * would watch them vanish.
 *
 * Capped, because it is unbounded user input reaching a database column.
 */
export const noteBodySchema = z.string().max(NOTE_BODY_LIMIT, "That note is too long.");

/** Creating a note in a category. Both fields optional — "New note" makes an empty one. */
export const createNoteSchema = z.object({
  categoryId: z.number().int().positive(),
  // `.default("")` applied **here** rather than on the shared base schema, and that
  // distinction is load-bearing. A created note is empty, so a default is right; but on
  // `saveNoteSchema` below an absent key has to stay *absent*, because that is what tells
  // the repository to leave the stored column alone.
  //
  // With the default on the base, `noteTitleSchema.optional()` still produced `""` for a
  // missing key — so every autosave of the body silently blanked the note's title. These
  // two shapes exist to keep that apart.
  title: noteTitleSchema.default(""),
  body: noteBodySchema.default(""),
});

/**
 * Saving a note — what autosave posts.
 *
 * Both `title` and `body` are optional so the two can be written independently: renaming
 * a note must not blank its body, and an autosave of the body must not clear a title the
 * reader just set. The use-case leaves an omitted field alone.
 *
 * `categoryId` is **not** here. Moving a note between tabs is a different operation with
 * different rules (the target has to exist), and folding it in would mean an autosave
 * carrying a stale category could silently re-file a note the reader had moved.
 */
export const saveNoteSchema = z.object({
  id: z.number().int().positive(),
  title: noteTitleSchema.optional(),
  body: noteBodySchema.optional(),
});

/** Deleting one note. */
export const deleteNoteSchema = z.object({
  id: z.number().int().positive(),
});

/**
 * Reading one tab's notes.
 *
 * `categoryId` is optional: with no id the use-case resolves the first category, which
 * is what the window's first open does.
 */
export const listNotesSchema = z.object({
  categoryId: z.number().int().positive().optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type RenameCategoryInput = z.infer<typeof renameCategorySchema>;
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>;
export type DeleteCategoryInput = z.infer<typeof deleteCategorySchema>;
export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type SaveNoteInput = z.infer<typeof saveNoteSchema>;
export type DeleteNoteInput = z.infer<typeof deleteNoteSchema>;
export type ListNotesInput = z.infer<typeof listNotesSchema>;
