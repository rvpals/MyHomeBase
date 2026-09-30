import { z } from "zod";
import { imageUploadSchema } from "@/lib/shared/image-upload";
import { RECIPE_RATING_MAX, RECIPE_RATING_MIN, RECIPE_TAG_EDIT_MODES } from "./types";

/**
 * A recipe photograph. 2 MB, well above the icon caps elsewhere in the app
 * (64 KB for a category glyph) because this is a full-bleed photograph of a
 * finished dish, not a 20px mark — and well under what a phone camera emits, so
 * an unscaled upload is refused with a message rather than stored.
 */
export const MAX_RECIPE_PICTURE_BYTES = 2 * 1024 * 1024;

export const recipePictureSchema = imageUploadSchema;
export type RecipePictureInput = z.infer<typeof recipePictureSchema>;

/**
 * A tag name.
 *
 * Lower-cased and trimmed so "Weeknight", "weeknight" and " weeknight " are one
 * tag rather than three — there is no managed tag list to reconcile them later,
 * since tags are created inline as a recipe is written.
 */
const tagNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "A tag cannot be blank.")
  .max(40, "Keep a tag under 40 characters.");

/**
 * A category name — what the dish IS. Blank means uncategorised.
 *
 * Deliberately NOT `.toLowerCase()`, which is the one way this parts company
 * with `tagNameSchema` directly above. A tag renders as a small chip where
 * lower case reads as deliberate; a category is a display label in a column and
 * a filter, where "dessert" would read as a bug. So the case the reader typed
 * is what gets stored, and the case-insensitivity lives in the *matching*
 * instead — the repository compares and groups `COLLATE NOCASE`, so picking
 * "Dessert" from the dropdown and typing "dessert" land on one category.
 *
 * See migrations/0120_add_category_to_recipes.md for the full reasoning.
 */
const categoryValueSchema = z
  .string()
  .trim()
  .max(40, "Keep a category under 40 characters.");

const categorySchema = categoryValueSchema.optional().default("");

/** Drops blanks and duplicates, so the repository never writes a dead row. */
const tagListSchema = z
  .array(tagNameSchema)
  .default([])
  .transform((tags) => [...new Set(tags)].sort());

// Two shapes per nullable/blankable field, and the split is load-bearing.
//
// `…ValueSchema` is the bare validator. `…Schema` is that plus `.default()`, for
// the create/update form where an omitted field means "use the empty value".
//
// A bulk edit must use the BARE one, because `.default()` beats `.optional()` in
// zod: a defaulted-then-optional field materialises on every parse, so an omitted
// `sourceUrl` would arrive as `""` and blank that column across the whole
// selection — precisely the accident the bulk dialog's tick-boxes exist to
// prevent — and the "pick at least one field" check would pass on an empty edit
// because two keys are always present. Both were caught by the unit tests.

/**
 * The rating.
 *
 * `null` is a real value meaning unrated, so a new recipe is not silently a 1.
 * The blank string maps to `null` because that is what an emptied number input
 * submits — handling it here keeps the coercion out of every form.
 */
const ratingValueSchema = z
  .union([z.literal(""), z.null(), z.coerce.number()])
  .transform((value) => (value === "" || value === null ? null : value))
  .refine(
    (value) =>
      value === null ||
      (Number.isInteger(value) && value >= RECIPE_RATING_MIN && value <= RECIPE_RATING_MAX),
    `Rating must be a whole number from ${RECIPE_RATING_MIN} to ${RECIPE_RATING_MAX}, or blank.`,
  );

/** Omitting the rating on a create/update means unrated, not "required". */
const ratingSchema = ratingValueSchema.optional().default(null);

/**
 * The source.
 *
 * Validated only when non-blank — most recipes come off a card or out of a head,
 * so "no source" is ordinary, but a typo'd URL should be caught rather than
 * rendered as a dead link.
 */
const sourceUrlValueSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || z.string().url().safeParse(value).success,
    "Enter a valid URL, or leave it blank.",
  );

const sourceUrlSchema = sourceUrlValueSchema.optional().default("");

export const recipeIdSchema = z.number().int().positive();

export const recipeIdsSchema = z
  .array(recipeIdSchema)
  .min(1, "Select at least one recipe.");

/**
 * Creating or replacing a recipe.
 *
 * Every text field defaults to `""` rather than being optional, matching the
 * NOT NULL DEFAULT '' columns: a missing value is blank here, never NULL. Only
 * `rating` is genuinely nullable, and that is the whole point of it.
 */
export const createRecipeSchema = z.object({
  name: z.string().trim().min(1, "A recipe needs a name."),
  description: z.string().trim().default(""),
  ingredients: z.string().default(""),
  directions: z.string().default(""),
  notes: z.string().default(""),
  madeCount: z.coerce
    .number()
    .int("Made count must be a whole number.")
    .min(0, "Made count cannot be negative.")
    .default(0),
  rating: ratingSchema,
  category: categorySchema,
  sourceUrl: sourceUrlSchema,
  tags: tagListSchema,
});

export type CreateRecipeInput = z.input<typeof createRecipeSchema>;
export type RecipeWriteData = z.output<typeof createRecipeSchema>;

export const updateRecipeSchema = createRecipeSchema;
export type UpdateRecipeInput = z.input<typeof updateRecipeSchema>;

/**
 * A bulk edit.
 *
 * Every field is optional and **an omitted field is left alone** — that is the
 * contract the whole feature rests on. A blank box in the dialog must not blank
 * the column across 20 recipes, so the view sends only what was explicitly
 * ticked, and `applyBulkEdit` writes only the keys present.
 *
 * Name, ingredients and directions are absent on purpose: setting 20 recipes to
 * one name is never the intent, and there is no sane merge for a method.
 */
export const bulkUpdateRecipesSchema = z
  .object({
    ids: recipeIdsSchema,
    // The BARE validators, not the defaulted ones — see the note above them.
    // A defaulted field would arrive on every parse, so omitting it would blank
    // the column instead of leaving it alone.
    rating: ratingValueSchema.optional(),
    madeCount: z.coerce.number().int().min(0).optional(),
    category: categoryValueSchema.optional(),
    sourceUrl: sourceUrlValueSchema.optional(),
    tagEdit: z
      .object({
        mode: z.enum(RECIPE_TAG_EDIT_MODES),
        tags: tagListSchema,
      })
      .optional(),
  })
  .refine(
    (input) =>
      input.rating !== undefined ||
      input.madeCount !== undefined ||
      input.category !== undefined ||
      input.sourceUrl !== undefined ||
      input.tagEdit !== undefined,
    "Pick at least one field to change.",
  );

export type BulkUpdateRecipesInput = z.input<typeof bulkUpdateRecipesSchema>;
export type BulkUpdateRecipesData = z.output<typeof bulkUpdateRecipesSchema>;

export const bulkDeleteRecipesSchema = z.object({ ids: recipeIdsSchema });
export type BulkDeleteRecipesInput = z.input<typeof bulkDeleteRecipesSchema>;

/** Attaching a picture to a recipe. */
export const setRecipePictureSchema = z.object({
  id: recipeIdSchema,
  picture: recipePictureSchema,
});

export type SetRecipePictureInput = z.input<typeof setRecipePictureSchema>;

/** What the list screen filters and sorts by. Parsed from search params. */
export const recipeQuerySchema = z.object({
  search: z.string().trim().default(""),
  tag: z.string().trim().toLowerCase().default(""),
  // No `.toLowerCase()`, unlike `tag`: categories are stored as typed, and the
  // repository's comparison is `COLLATE NOCASE`. Lower-casing here would be
  // harmless for matching but would make a bookmarked URL's category differ
  // from the one the filter renders as selected.
  category: z.string().trim().default(""),
});

export type RecipeQueryInput = z.input<typeof recipeQuerySchema>;
export type RecipeQuery = z.output<typeof recipeQuerySchema>;
