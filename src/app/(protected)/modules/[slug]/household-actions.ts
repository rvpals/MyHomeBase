"use server";

import { revalidatePath } from "next/cache";
import {
  bulkUpdateRecipes,
  clearHsaReceipt,
  clearRecipeImage,
  createHsaCard,
  createHsaExpense,
  createRecipe,
  deleteHsaCard,
  deleteHsaExpenses,
  deleteRecipe,
  deleteRecipes,
  describeReceiptRootCheck,
  getRecipe,
  incrementMadeCount,
  renameHsaCard,
  setHsaCardActive,
  setHsaReceipt,
  setHsaReceiptRoot,
  setHsaReimbursed,
  setRecipeImage,
  updateHsaExpense,
  updateRecipe,
  type BulkUpdateRecipesInput,
  type CreateRecipeInput,
  type FolderListing,
  type HsaExpenseInput,
  type HsaReceiptUploadInput,
  type Recipe,
  type RecipePictureInput,
  type UpdateRecipeInput,
} from "@/lib/household";
import { deps } from "@/lib/wiring";
import { requireAdmin, requireModuleAccess } from "../../require-access";
import { hsaReceiptFiles } from "./household-receipt-root";

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

// ---------------------------------------------------------------------------------
// HSA Tracker. Same rule as above: each export authorises first, inside the try.
//
// Expenses and receipts are open to anyone with the Household module. The receipt
// folder and the card list live on Configuration and are admin-only: browsing lists
// every folder the server can see, which on the NAS is the whole share.
// ---------------------------------------------------------------------------------

const HSA_PATH = "/modules/household/hsa";
const CONFIGURATION_PATH = "/modules/household/configuration";

/** Carries the new row's id, which the editor needs to attach a held receipt. */
export async function createHsaExpenseAction(input: HsaExpenseInput): Promise<CreateRecipeResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const created = createHsaExpense(deps.hsaRepo, input);
    revalidatePath(HSA_PATH);
    return { ok: true, id: created.id };
  } catch (error) {
    return toErrorResult(error, "Could not save that expense.");
  }
}

/** Also renames or moves the receipt file when the date, payee or amount changed. */
export async function updateHsaExpenseAction(
  id: number,
  input: HsaExpenseInput,
): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    await updateHsaExpense(deps.hsaRepo, hsaReceiptFiles(), id, input);
    revalidatePath(HSA_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not save that expense.");
  }
}

export interface DeleteHsaExpensesActionResult extends BulkActionResult {
  /** Receipt files the rows pointed at that could not be deleted from the folder. */
  filesNotDeleted?: string[];
}

export async function deleteHsaExpensesAction(ids: number[]): Promise<DeleteHsaExpensesActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const result = await deleteHsaExpenses(deps.hsaRepo, hsaReceiptFiles(), { ids });
    revalidatePath(HSA_PATH);
    return { ok: true, affected: result.removed, filesNotDeleted: result.filesNotDeleted };
  } catch (error) {
    return toErrorResult(error, "Could not delete those expenses.");
  }
}

export async function setHsaReimbursedAction(
  ids: number[],
  isReimbursed: boolean,
): Promise<BulkActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const affected = setHsaReimbursed(deps.hsaRepo, { ids, isReimbursed });
    revalidatePath(HSA_PATH);
    return { ok: true, affected };
  } catch (error) {
    return toErrorResult(error, "Could not update those expenses.");
  }
}

export interface SetHsaReceiptActionResult extends ActionResult {
  /** A replaced file that could not be deleted and is still in the folder. */
  oldFileNotDeleted?: string;
}

/**
 * Files a receipt in the receipt folder. An action rather than a route handler: the
 * editor shrinks a large phone photo first and the cap is 2.5 MB, which base64 turns
 * into roughly 3.4 MB — inside Next's 4 MB `serverActions.bodySizeLimit`.
 */
export async function setHsaReceiptAction(
  id: number,
  receipt: HsaReceiptUploadInput,
): Promise<SetHsaReceiptActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    const result = await setHsaReceipt(deps.hsaRepo, hsaReceiptFiles(), { id, receipt });
    revalidatePath(HSA_PATH);
    return { ok: true, oldFileNotDeleted: result.oldFileNotDeleted };
  } catch (error) {
    return toErrorResult(error, "Could not save that receipt.");
  }
}

/** Unlinks the receipt and deletes its file from the folder. */
export async function clearHsaReceiptAction(id: number): Promise<ActionResult> {
  try {
    await requireModuleAccess(ACCESS_MODULE_SLUG);
    await clearHsaReceipt(deps.hsaRepo, hsaReceiptFiles(), id);
    revalidatePath(HSA_PATH);
    return { ok: true };
  } catch (error) {
    // The use-case unlinks before deleting, so even a failure may have changed the row.
    revalidatePath(HSA_PATH);
    return toErrorResult(error, "Could not remove that receipt.");
  }
}

// --- Configuration: admin-only --------------------------------------------------

export async function createHsaCardAction(name: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    createHsaCard(deps.hsaRepo, name);
    revalidatePath(CONFIGURATION_PATH);
    revalidatePath(HSA_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not add that card.");
  }
}

export async function renameHsaCardAction(id: number, name: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    renameHsaCard(deps.hsaRepo, id, name);
    revalidatePath(CONFIGURATION_PATH);
    revalidatePath(HSA_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not rename that card.");
  }
}

export async function setHsaCardActiveAction(id: number, isActive: boolean): Promise<ActionResult> {
  try {
    await requireAdmin();
    setHsaCardActive(deps.hsaRepo, id, isActive);
    revalidatePath(CONFIGURATION_PATH);
    revalidatePath(HSA_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not update that card.");
  }
}

export async function deleteHsaCardAction(id: number): Promise<ActionResult> {
  try {
    await requireAdmin();
    deleteHsaCard(deps.hsaRepo, id);
    revalidatePath(CONFIGURATION_PATH);
    revalidatePath(HSA_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not delete that card.");
  }
}

export interface BrowseFoldersResult extends ActionResult {
  listing?: FolderListing;
}

/** One level of the server's folders, for the Browse dialog. Blank starts at the root. */
export async function browseFoldersAction(path: string): Promise<BrowseFoldersResult> {
  try {
    await requireAdmin();
    return { ok: true, listing: await deps.receiptFileStore.listFolders(path) };
  } catch (error) {
    return toErrorResult(error, "Could not open that folder.");
  }
}

/** Whether the server can write to a folder, without saving it. */
export async function checkReceiptRootAction(path: string): Promise<ActionResult & { message?: string }> {
  try {
    await requireAdmin();
    const check = await deps.receiptFileStore.checkRoot(path);
    const message = describeReceiptRootCheck(check);
    return check.kind === "ok" ? { ok: true, message } : { ok: false, error: message };
  } catch (error) {
    return toErrorResult(error, "Could not check that folder.");
  }
}

/** Saves the folder (checked first) or, with a blank path, clears it. */
export async function saveReceiptRootAction(path: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    await setHsaReceiptRoot(deps.moduleRepo, deps.moduleSettingsRepo, deps.receiptFileStore, path);
    revalidatePath(CONFIGURATION_PATH);
    revalidatePath(HSA_PATH);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Could not save that folder.");
  }
}
