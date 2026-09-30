/**
 * The Household module's domain types.
 *
 * Two shapes for a recipe, deliberately. `RecipeSummary` is what a list renders
 * and carries no picture bytes and no long text; `Recipe` is the whole record,
 * read one at a time. The split is the same one every BLOB-bearing table here
 * makes (expense card art, investment-account icons): a list of 200 recipes must
 * never pull 200 photographs into a JSON payload.
 */

/** The bounds of the 1-10 rating. Enforced in zod, not by a CHECK constraint. */
export const RECIPE_RATING_MIN = 1;
export const RECIPE_RATING_MAX = 10;

/** A recipe as a list row: no picture bytes, no ingredients, no directions. */
export interface RecipeSummary {
  id: number;
  name: string;
  description: string;
  /** How many times it has been made. Starts at 0. */
  madeCount: number;
  /** 1-10, or `null` when unrated — which is a different fact from a 1. */
  rating: number | null;
  /**
   * What the dish is — Dinner, Dessert. Empty when uncategorised.
   *
   * Stored as typed and matched case-insensitively, unlike a tag, which is
   * lower-cased at the boundary. A category is a display label; see
   * migrations/0120_add_category_to_recipes.md.
   */
  category: string;
  /** Where it came from. Empty when unrecorded. */
  sourceUrl: string;
  /** Whether a picture exists, derived in SQL so no bytes are read. */
  hasPicture: boolean;
  /** Tag names, ascending. */
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** The whole recipe, as the viewer and the editor need it. */
export interface Recipe extends RecipeSummary {
  /** One per line, as typed. Rendered as a list; stored as one block. */
  ingredients: string;
  /** One step per line, likewise. */
  directions: string;
  notes: string;
}

/** A recipe's picture, read only by the route that serves the bytes. */
export interface RecipeImage {
  data: Buffer;
  mimeType: string;
}

/** A tag and how many recipes carry it — what the tag filter lists. */
export interface RecipeTagCount {
  name: string;
  recipeCount: number;
}

/**
 * A category in use, and how many recipes carry it.
 *
 * Derived from the recipes themselves (`SELECT DISTINCT`), not from a catalog
 * table — so the dropdown can never offer a category nothing uses, and can
 * never miss one that something does. Feeds both the editor's picker and the
 * list's filter.
 */
export interface RecipeCategoryCount {
  name: string;
  recipeCount: number;
}

/**
 * How a bulk edit changes a selection's tags.
 *
 * Three modes rather than a plain list, because "tag these 12 as Weeknight"
 * and "these are no longer Vegetarian" are both common and neither is a
 * replacement. `replace` is kept for the case where a selection's tags are
 * simply wrong.
 */
export const RECIPE_TAG_EDIT_MODES = ["add", "remove", "replace"] as const;

export type RecipeTagEditMode = (typeof RECIPE_TAG_EDIT_MODES)[number];
