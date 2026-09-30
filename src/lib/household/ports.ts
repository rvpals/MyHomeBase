import type { DecodedImage } from "@/lib/shared/image-upload";
import type { BulkUpdateRecipesData, RecipeQuery, RecipeWriteData } from "./schema";
import type { Recipe, RecipeCategoryCount, RecipeSummary, RecipeTagCount } from "./types";

/**
 * What the Household use-cases need from storage.
 *
 * The use-cases depend on THIS, not on a database — which is what lets the web
 * app, the CLI and the tests each supply their own.
 */
export interface HouseholdRepository {
  /**
   * The recipe list, newest first, filtered by the query.
   *
   * Returns summaries: no picture bytes and no long text. Filtering happens in
   * SQL rather than in the use-case because the alternative is reading every
   * row to discard most of them.
   */
  listRecipes(query: RecipeQuery): RecipeSummary[];

  /** The whole record, or `undefined` when the id is unknown. */
  getRecipeById(id: number): Recipe | undefined;

  createRecipe(input: RecipeWriteData): Recipe;

  /** Replaces every field, tags included. `undefined` when the id is unknown. */
  updateRecipe(id: number, input: RecipeWriteData): Recipe | undefined;

  /** Also clears the recipe's tag rows. */
  deleteRecipe(id: number): void;

  /**
   * Deletes several in one transaction, returning how many rows were actually
   * removed — an id that no longer exists is simply not counted, so a stale
   * selection is not an error.
   */
  deleteRecipes(ids: number[]): number;

  /**
   * Applies a partial edit to each id in one transaction, returning how many
   * rows changed. Only the fields present on `input` are written.
   */
  bulkUpdateRecipes(input: BulkUpdateRecipesData): number;

  /** Adds one to the counter, returning the new value. `undefined` if unknown. */
  incrementMadeCount(id: number): number | undefined;

  /** The bytes, read only by the route that serves them. */
  getRecipeImage(id: number): DecodedImage | undefined;

  setRecipeImage(id: number, image: DecodedImage): void;

  clearRecipeImage(id: number): void;

  /** Every tag in use, with its recipe count, for the filter. */
  listRecipeTags(): RecipeTagCount[];

  /**
   * Every category in use, with its recipe count.
   *
   * Derived from the recipes with `SELECT DISTINCT` rather than read from a
   * catalog table, so the editor's "previously used" dropdown and the list's
   * filter can never drift from what is actually stored. Grouped
   * `COLLATE NOCASE`, so "Dessert" and "dessert" are one entry.
   */
  listRecipeCategories(): RecipeCategoryCount[];

  /**
   * Ids of every recipe with this name, case-insensitively, ordered by id.
   *
   * The CSV importer's duplicate check. Returns a LIST rather than one id
   * because nothing stops two recipes sharing a name, and the importer pairs
   * the Nth row in the file with the Nth stored copy — which needs a stable
   * order, hence `ORDER BY id`.
   */
  findRecipeIdsByName(name: string): number[];
}
