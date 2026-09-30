/**
 * The Household module's use-cases: functions that take data and return data.
 *
 * Every one receives its repository as a parameter rather than importing one,
 * so the same call runs under the web app, the CLI and a unit test with a fake.
 */

import { decodeImageUpload, type DecodedImage } from "@/lib/shared/image-upload";
import type { CarouselImageProcessor } from "@/lib/modules";
import type { HouseholdRepository } from "./ports";
import { resizeRecipePicture } from "./resize-recipe-picture";
import {
  MAX_RECIPE_PICTURE_BYTES,
  bulkDeleteRecipesSchema,
  bulkUpdateRecipesSchema,
  createRecipeSchema,
  recipeIdSchema,
  recipeQuerySchema,
  setRecipePictureSchema,
  updateRecipeSchema,
  type BulkDeleteRecipesInput,
  type BulkUpdateRecipesInput,
  type CreateRecipeInput,
  type RecipeQueryInput,
  type SetRecipePictureInput,
  type UpdateRecipeInput,
} from "./schema";
import type { Recipe, RecipeCategoryCount, RecipeSummary, RecipeTagCount } from "./types";

/** The recipe list for the home screen, filtered by search text and tag. */
export function listRecipes(
  repo: HouseholdRepository,
  query: RecipeQueryInput = {},
): RecipeSummary[] {
  return repo.listRecipes(recipeQuerySchema.parse(query));
}

/** One whole recipe. `undefined` rather than a throw — a deleted id is ordinary. */
export function getRecipe(repo: HouseholdRepository, id: number): Recipe | undefined {
  return repo.getRecipeById(recipeIdSchema.parse(id));
}

export function createRecipe(repo: HouseholdRepository, input: CreateRecipeInput): Recipe {
  return repo.createRecipe(createRecipeSchema.parse(input));
}

/**
 * Replaces a recipe.
 *
 * Throws on an unknown id rather than returning undefined: the caller has an
 * edit form open on a record it believes exists, so silence would look like a
 * successful save that vanished.
 */
export function updateRecipe(
  repo: HouseholdRepository,
  id: number,
  input: UpdateRecipeInput,
): Recipe {
  const recipeId = recipeIdSchema.parse(id);
  const updated = repo.updateRecipe(recipeId, updateRecipeSchema.parse(input));
  if (!updated) throw new Error(`No recipe with id ${recipeId}.`);
  return updated;
}

export function deleteRecipe(repo: HouseholdRepository, id: number): void {
  repo.deleteRecipe(recipeIdSchema.parse(id));
}

/** Returns how many were actually removed, so the caller can say "3 deleted". */
export function deleteRecipes(
  repo: HouseholdRepository,
  input: BulkDeleteRecipesInput,
): number {
  return repo.deleteRecipes(bulkDeleteRecipesSchema.parse(input).ids);
}

/**
 * Applies one partial edit across a selection, returning how many changed.
 *
 * The schema is what guarantees an omitted field is left alone and that at
 * least one field was actually picked — an empty edit silently touching every
 * row's `updated_at` is worse than an error.
 */
export function bulkUpdateRecipes(
  repo: HouseholdRepository,
  input: BulkUpdateRecipesInput,
): number {
  return repo.bulkUpdateRecipes(bulkUpdateRecipesSchema.parse(input));
}

/**
 * "I made this again" — one click, not an edit.
 *
 * Its own use-case rather than a field on the update form because bumping a
 * counter should not require re-submitting every other field, which would let
 * two people cooking from the same recipe overwrite each other's notes.
 */
export function incrementMadeCount(repo: HouseholdRepository, id: number): number {
  const recipeId = recipeIdSchema.parse(id);
  const madeCount = repo.incrementMadeCount(recipeId);
  if (madeCount === undefined) throw new Error(`No recipe with id ${recipeId}.`);
  return madeCount;
}

/** The picture bytes. Only the serving route calls this. */
export function getRecipeImage(
  repo: HouseholdRepository,
  id: number,
): DecodedImage | undefined {
  return repo.getRecipeImage(recipeIdSchema.parse(id));
}

/**
 * Decodes, shrinks and stores an uploaded picture, refusing anything over the cap.
 *
 * `processor` is optional so the CLI and the tests can store bytes verbatim, but
 * the web upload always passes it — without it a 2 MB original is stored whole and
 * then downloaded whole to fill a 36px thumbnail. Same shape, and the same
 * reasoning, as `setModuleCarouselImage`.
 *
 * The cap stays checked against the **incoming** file rather than the resized
 * result: it is there to stop a huge request body reaching this process, and
 * shrinking afterwards must not become a way to smuggle a 50 MB upload through.
 */
export async function setRecipeImage(
  repo: HouseholdRepository,
  input: SetRecipePictureInput,
  processor?: CarouselImageProcessor,
): Promise<void> {
  const { id, picture } = setRecipePictureSchema.parse(input);
  if (!repo.getRecipeById(id)) throw new Error(`No recipe with id ${id}.`);
  const decoded = decodeImageUpload(picture, MAX_RECIPE_PICTURE_BYTES);
  const stored = processor ? await resizeRecipePicture(processor, decoded) : decoded;
  repo.setRecipeImage(id, { data: stored.data, mimeType: stored.mimeType });
}

export function clearRecipeImage(repo: HouseholdRepository, id: number): void {
  repo.clearRecipeImage(recipeIdSchema.parse(id));
}

/** Every tag in use, with counts — what the filter renders. */
export function listRecipeTags(repo: HouseholdRepository): RecipeTagCount[] {
  return repo.listRecipeTags();
}

/**
 * Every category in use, with counts.
 *
 * Feeds both the editor's "previously used" dropdown and the list's filter —
 * one source, so the two can never offer different vocabularies.
 */
export function listRecipeCategories(repo: HouseholdRepository): RecipeCategoryCount[] {
  return repo.listRecipeCategories();
}

/**
 * Splits a stored block into displayable lines.
 *
 * Ingredients and directions are stored as one TEXT block (one item per line)
 * rather than as structured rows — a plain list is what a cook reads, and
 * quantity/unit parsing would buy a scaling feature nobody asked for. Blank
 * lines are dropped so a trailing newline doesn't render an empty bullet.
 */
export function toLines(block: string): string[] {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
