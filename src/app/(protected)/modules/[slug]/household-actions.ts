"use server";

import { revalidatePath } from "next/cache";
import {
  bulkUpdateRecipes,
  clearRecipeImage,
  createRecipe,
  deleteRecipe,
  deleteRecipes,
  getRecipe,
  incrementMadeCount,
  setRecipeImage,
  updateRecipe,
  type BulkUpdateRecipesInput,
  type CreateRecipeInput,
  type Recipe,
  type RecipePictureInput,
  type UpdateRecipeInput,
} from "@/lib/household";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "household";

const RECIPES_PATH = "/modules/household/recipes";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

// Every export below opens with `requireModuleAccess`, INSIDE the try so a denial
// renders as an inline error rather than an unhandled rejection. A server action is
// its own POST endpoint: neither the `(protected)` layout nor the page's own access
// check runs before one fires, so hiding the module from the tree does nothing to
// stop these being invoked directly.

export interface GetRecipeResult extends ActionResult {
  recipe?: Recipe;
}

/**
 * The whole recipe, read on demand.
 *
 * The list screen holds `RecipeSummary` rows, which deliberately carry no
 * `ingredients`, `directions` or `notes` — a list of 200 recipes must not pull
 * every method into the payload. So the editor and the viewer cannot be filled
 * from a grid row; they have to fetch. Opening the editor straight off a row is
 * exactly how those three fields came up blank on a recipe that had them.
 */
export async function getRecipeAction(id: number): Promise<GetRecipeResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const recipe = getRecipe(deps.householdRepo, id);
    if (!recipe) return { ok: false, error: `No recipe with id ${id}.` };
    return { ok: true, recipe };
  } catch (error) {
    return toErrorResult(error, "Could not load that recipe.");
  }
}

/** Carries the new row's id, which the editor needs to attach a held picture. */
export interface CreateRecipeResult extends ActionResult {
  id?: number;
}

/**
 * Creates a recipe and reports its new id.
 *
 * The id is returned because a picture chosen in the *add* editor has nothing to
 * attach to until the row exists — the editor holds the file, saves, then posts
 * it against this id. Returning it here is what keeps that a single form to the
 * reader instead of "save, reopen, add picture".
 */
export async function createRecipeAction(
  input: CreateRecipeInput,
): Promise<CreateRecipeResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const created = createRecipe(deps.householdRepo, input);
    revalidatePath(RECIPES_PATH);
    return { ok: true, id: created.id };
  } catch (error) {
    return toErrorResult(error, "Could not save that recipe.");
  }
}

export async function updateRecipeAction(
  id: number,
  input: UpdateRecipeInput,
): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    updateRecipe(deps.householdRepo, id, input);
    revalidatePath(RECIPES_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not save that recipe.");
  }
}

export async function deleteRecipeAction(id: number): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    deleteRecipe(deps.householdRepo, id);
    revalidatePath(RECIPES_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not delete that recipe.");
  }
}

export interface BulkActionResult extends ActionResult {
  /** How many rows actually changed, so the view can report it honestly. */
  affected?: number;
}

export async function deleteRecipesAction(ids: number[]): Promise<BulkActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const affected = deleteRecipes(deps.householdRepo, { ids });
    revalidatePath(RECIPES_PATH);
    return { ok: true, affected };
  } catch (error) {
    return toErrorResult(error, "Could not delete those recipes.");
  }
}

export async function bulkUpdateRecipesAction(
  input: BulkUpdateRecipesInput,
): Promise<BulkActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const affected = bulkUpdateRecipes(deps.householdRepo, input);
    revalidatePath(RECIPES_PATH);
    return { ok: true, affected };
  } catch (error) {
    return toErrorResult(error, "Could not update those recipes.");
  }
}

/** "I made this again" — one click from the list, not a trip through the edit form. */
export async function incrementMadeCountAction(id: number): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    incrementMadeCount(deps.householdRepo, id);
    revalidatePath(RECIPES_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not update that recipe.");
  }
}

/**
 * Attaches a picture.
 *
 * An action rather than a route handler, unlike the Tools uploads: the cap here is
 * 2 MB, comfortably inside Next's 4 MB `serverActions.bodySizeLimit`, so there is
 * nothing to stream around.
 */
export async function setRecipePictureAction(
  id: number,
  picture: RecipePictureInput,
): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    // The processor is what makes this resize rather than store the original.
    // `carouselImageProcessor` is a bare probe/encode adapter with nothing
    // carousel-specific in it, so it is shared rather than duplicated — see
    // `resizeRecipePicture`.
    await setRecipeImage(deps.householdRepo, { id, picture }, deps.carouselImageProcessor);
    revalidatePath(RECIPES_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not save that picture.");
  }
}

export async function clearRecipePictureAction(id: number): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    clearRecipeImage(deps.householdRepo, id);
    revalidatePath(RECIPES_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not remove that picture.");
  }
}
