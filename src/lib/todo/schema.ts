import { z } from "zod";

/**
 * How many lists the household may have.
 *
 * The real constraint is the widget's tab strip: past a dozen or so, tabs stop being a
 * usable control at any width, and on a phone they are already scrolling. 40 is a
 * generous ceiling that still stops a script making the home card unrenderable. The same
 * number as the Scratchpad's `CATEGORY_LIMIT`, for the same reason and deliberately not
 * shared with it — two features that happen to agree today are not one setting.
 */
export const CATEGORY_LIMIT = 40;

/**
 * How many items one list may hold, open and completed together.
 *
 * Enforced by **refusing the create**, never by pruning the oldest. An item is something
 * somebody deliberately wrote down, so silently dropping one to make room would be data
 * loss — the same call `createNote` makes, and the opposite of the calculator's rolling
 * tape.
 *
 * Counted across both halves because completed items are what actually accumulate:
 * nothing prunes them, and the screenshot this was built from already had 146 in one
 * list. 2000 is far past where a list stops being usable while keeping the per-list read
 * trivial.
 */
export const ITEMS_PER_CATEGORY_LIMIT = 2000;

/**
 * A list's name.
 *
 * Trimmed before validation, so " Work " and "Work" are the same name and a trailing
 * space can't smuggle past the case-insensitive uniqueness check. 40 characters is what
 * fits in a tab; the check is here rather than in CSS because a name that doesn't fit
 * breaks the strip for everyone, not just whoever typed it.
 *
 * Newlines are rejected outright: a tab label is one line by definition, and a pasted
 * multi-line string would otherwise render as a tab of unbounded height.
 */
export const categoryNameSchema = z
  .string()
  .trim()
  .min(1, "A list needs a name.")
  .max(40, "That list name is too long.")
  .refine((name) => !/[\r\n]/.test(name), "A list name has to be a single line.");

/** Creating a list. The position is assigned by the use-case, not supplied. */
export const createCategorySchema = z.object({
  name: categoryNameSchema,
});

/** Renaming a list. */
export const renameCategorySchema = z.object({
  id: z.number().int().positive(),
  name: categoryNameSchema,
});

/**
 * Reordering the whole panel: every list id, in the order they should appear.
 *
 * The **whole** list rather than one id and a direction, deliberately. A move-up /
 * move-down control produces a new order, and applying it as one write means the panel
 * can never be left half-reordered by a failed second call. The use-case checks the list
 * against what exists rather than trusting it.
 */
export const reorderCategoriesSchema = z.object({
  ids: z.array(z.number().int().positive()).max(CATEGORY_LIMIT),
});

/** Deleting a list. Refused while items are filed under it — see `deleteCategory`. */
export const deleteCategorySchema = z.object({
  id: z.number().int().positive(),
});

/**
 * An item's title.
 *
 * Required and single-line — an item with no title is not an item, and the card renders
 * each as one line. 500 rather than the name's 40: the screenshot's longest item is a
 * full sentence ("Open Fidelity Roth IRA for Ting and put more in Roth IRA for me this
 * year"), and truncating what someone needs to remember is worse than a wrapped line.
 */
export const itemTitleSchema = z
  .string()
  .trim()
  .min(1, "An item needs a title.")
  .max(500, "That item is too long.")
  .refine((title) => !/[\r\n]/.test(title), "An item title has to be a single line.");

/**
 * An item's detail line.
 *
 * Blank is valid and is the ordinary case. **Not trimmed of its interior** but trimmed
 * at the ends, unlike a scratchpad body: this is a short annotation rendered under the
 * title, not a document someone pastes indented text into, so leading whitespace is a
 * typo rather than intent.
 */
export const itemNotesSchema = z
  .string()
  .trim()
  .max(2000, "That note is too long.");

/** Adding an item to a list. `notes` is optional — the ordinary add is a title alone. */
export const createItemSchema = z.object({
  categoryId: z.number().int().positive(),
  title: itemTitleSchema,
  // `.default("")` is safe here, unlike on `updateItemSchema` below, because a created
  // item genuinely has no notes yet. On an update an absent key has to stay *absent* —
  // that is what tells the use-case to leave the stored column alone. The Scratchpad's
  // schema records the bug that distinction prevents.
  notes: itemNotesSchema.default(""),
});

/**
 * Editing an item's text.
 *
 * Both fields optional so the two can be written independently: correcting a title must
 * not blank a note, and vice versa. The use-case leaves an omitted field alone.
 *
 * `categoryId` is **not** here. Moving an item between lists is a different operation
 * with a different rule (the target has to exist), and folding it in would mean an edit
 * carrying a stale list id could silently re-file an item someone had just moved.
 */
export const updateItemSchema = z.object({
  id: z.number().int().positive(),
  title: itemTitleSchema.optional(),
  notes: itemNotesSchema.optional(),
});

/**
 * Ticking or un-ticking an item.
 *
 * `isDone` is explicit rather than a toggle. A toggle computed from what the server
 * currently holds would flip the wrong way when two people tick the same item at once,
 * or when a click lands on a stale render — the screen knows which state it is asking
 * for, so it says so, and a repeated call is harmless.
 */
export const setItemDoneSchema = z.object({
  id: z.number().int().positive(),
  isDone: z.boolean(),
});

/** Deleting one item. The hover ✕ in the Completed group. */
export const deleteItemSchema = z.object({
  id: z.number().int().positive(),
});

/**
 * Moving an item within its list.
 *
 * The whole id list for one category, for the same reason `reorderCategoriesSchema`
 * takes one: a partial apply would leave the list half-ordered.
 */
export const reorderItemsSchema = z.object({
  categoryId: z.number().int().positive(),
  ids: z.array(z.number().int().positive()).max(ITEMS_PER_CATEGORY_LIMIT),
});

/**
 * Reading the board.
 *
 * `categoryId` is optional: with no id every list is read, which is what the screen and
 * the widget both do. With one, only that list — the CLI's `--list` path.
 */
export const listBoardSchema = z.object({
  categoryId: z.number().int().positive().optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type RenameCategoryInput = z.infer<typeof renameCategorySchema>;
export type ReorderCategoriesInput = z.infer<typeof reorderCategoriesSchema>;
export type DeleteCategoryInput = z.infer<typeof deleteCategorySchema>;
export type CreateItemInput = z.infer<typeof createItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type SetItemDoneInput = z.infer<typeof setItemDoneSchema>;
export type DeleteItemInput = z.infer<typeof deleteItemSchema>;
export type ReorderItemsInput = z.infer<typeof reorderItemsSchema>;
export type ListBoardInput = z.infer<typeof listBoardSchema>;
