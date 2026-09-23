"use server";

// Server actions for the Journal's saved-location library. Thin adapters:
// authorise, hand the raw input to a `lib/journal-locations` use-case (which
// validates it with the module's zod schema), revalidate, return.
//
// Separate from journal-actions.ts because the library is its own lib module
// with its own repository — keeping the two action files apart keeps the import
// graph honest about that.

import { revalidatePath } from "next/cache";
import {
  clearLocationTaxonomyIcon,
  countImportCandidates,
  countLocationsByCategory,
  countLocationsByTag,
  createSavedLocation,
  deleteLocationTaxonomy,
  deleteSavedLocation,
  generateLocationTaxonomyIcon,
  generateMissingLocationTaxonomyIcons,
  listLocationCategories,
  listLocationTags,
  promoteToSavedLocation,
  runImportBatch,
  saveLocationTaxonomy,
  searchSavedLocations,
  setLocationTaxonomyIcon,
  updateSavedLocation,
  type LocationIconFillSummary,
  type ImportBatchResult,
  type LocationSearchInput,
  type LocationTaxonomyKind,
  type PromoteLocationInput,
  type SaveLocationInput,
  type SavedLocationWithUsage,
  type UpdateLocationInput,
  type UpsertLocationTaxonomyInput,
} from "@/lib/journal-locations";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

const JOURNAL_MODULE_PATH = "/modules/journal";
const JOURNAL_MODULE_SLUG = "journal";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/**
 * Revalidates the three screens that read the library.
 *
 * All three, not just the one the reader is on: saving a place from the manager
 * has to change what the map draws and what the entry form's picker offers, and
 * a stale picker is the failure that would go unnoticed longest.
 */
function revalidateLocationScreens(): void {
  revalidatePath(`${JOURNAL_MODULE_PATH}/locations`);
  revalidatePath(`${JOURNAL_MODULE_PATH}/location-map`);
  revalidatePath(`${JOURNAL_MODULE_PATH}/location-metadata`);
  revalidatePath(`${JOURNAL_MODULE_PATH}/new-entry`);
}

export interface SavedLocationsResult extends ActionResult {
  locations?: SavedLocationWithUsage[];
}

/**
 * The places matching a query and/or filters.
 *
 * An action rather than a page read because all three callers narrow the list
 * interactively — the picker on every keystroke, the manager and the map as
 * filter chips are toggled.
 */
export async function searchSavedLocationsAction(
  input: LocationSearchInput,
): Promise<SavedLocationsResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    return { ok: true, locations: searchSavedLocations(deps.savedLocationRepo, input) };
  } catch (error) {
    return toErrorResult(error, "Failed to search saved locations.");
  }
}

export async function createSavedLocationAction(
  input: SaveLocationInput,
): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    createSavedLocation(deps.savedLocationRepo, input);
  } catch (error) {
    return toErrorResult(error, "Failed to save the location.");
  }
  revalidateLocationScreens();
  return { ok: true };
}

export async function updateSavedLocationAction(
  input: UpdateLocationInput,
): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    updateSavedLocation(deps.savedLocationRepo, input);
  } catch (error) {
    return toErrorResult(error, "Failed to update the location.");
  }
  revalidateLocationScreens();
  return { ok: true };
}

/**
 * Retires a place from the library.
 *
 * Entries that used it keep their coordinates and simply stop pointing here —
 * the view warns with the usage count before calling this, but the decision is
 * the reader's (see migration 0101).
 */
export async function deleteSavedLocationAction(id: number): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    deleteSavedLocation(deps.savedLocationRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete the location.");
  }
  revalidateLocationScreens();
  return { ok: true };
}

/** Turns a location already on an entry into a library row. */
export async function promoteToSavedLocationAction(
  input: PromoteLocationInput,
): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    promoteToSavedLocation(deps.savedLocationRepo, input);
  } catch (error) {
    return toErrorResult(error, "Failed to add the location to the library.");
  }
  revalidateLocationScreens();
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

export async function saveLocationTaxonomyAction(
  kind: LocationTaxonomyKind,
  input: UpsertLocationTaxonomyInput,
): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    saveLocationTaxonomy(deps.savedLocationRepo, kind, input);
  } catch (error) {
    return toErrorResult(error, "Failed to save.");
  }
  revalidateLocationScreens();
  return { ok: true };
}

export async function deleteLocationTaxonomyAction(
  kind: LocationTaxonomyKind,
  name: string,
): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    deleteLocationTaxonomy(deps.savedLocationRepo, kind, name);
  } catch (error) {
    return toErrorResult(error, "Failed to delete.");
  }
  revalidateLocationScreens();
  return { ok: true };
}

/**
 * Stores an icon a reader picked for a location category or tag.
 *
 * Takes the file as base64 rather than a `File`/FormData: the editor reads it in
 * the browser, and this keeps the action a plain data-in/data-out call that the
 * CLI could make identically.
 */
export async function saveLocationTaxonomyIconAction(
  kind: LocationTaxonomyKind,
  name: string,
  mimeType: string,
  base64Data: string,
): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    setLocationTaxonomyIcon(deps.savedLocationRepo, kind, name, {
      mimeType: mimeType as never,
      base64Data,
    });
  } catch (error) {
    return toErrorResult(error, "Failed to save the icon.");
  }
  revalidateLocationScreens();
  return { ok: true };
}

/** Removes the icon, leaving the category or tag in place. */
export async function clearLocationTaxonomyIconAction(
  kind: LocationTaxonomyKind,
  name: string,
): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    clearLocationTaxonomyIcon(deps.savedLocationRepo, kind, name);
  } catch (error) {
    return toErrorResult(error, "Failed to remove the icon.");
  }
  revalidateLocationScreens();
  return { ok: true };
}

/** Draws an icon from the row's name — the editor's ⚡ button. */
export async function generateLocationTaxonomyIconAction(
  kind: LocationTaxonomyKind,
  name: string,
): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    await generateLocationTaxonomyIcon(deps.savedLocationRepo, kind, name);
  } catch (error) {
    return toErrorResult(error, "Failed to generate an icon.");
  }
  revalidateLocationScreens();
  return { ok: true };
}

export interface LocationIconFillResult extends ActionResult {
  summary?: LocationIconFillSummary;
}

/** Draws an icon for every category and tag that hasn't got one. */
export async function generateMissingLocationIconsAction(): Promise<LocationIconFillResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  let summary: LocationIconFillSummary;
  try {
    summary = await generateMissingLocationTaxonomyIcons(deps.savedLocationRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to fill in the missing icons.");
  }
  revalidateLocationScreens();
  return { ok: true, summary };
}

export interface LocationTaxonomyResult extends ActionResult {
  categories?: { name: string; count: number }[];
  tags?: { name: string; count: number }[];
}

/** The two filter lists with their counts, for a client view that refreshes them. */
export async function listLocationTaxonomyAction(): Promise<LocationTaxonomyResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    return {
      ok: true,
      categories: countLocationsByCategory(deps.savedLocationRepo),
      tags: countLocationsByTag(deps.savedLocationRepo),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to read the location categories and tags.");
  }
}

/** Names only — what the save form's dropdowns offer. */
export async function listLocationTaxonomyNamesAction(): Promise<{
  categories: string[];
  tags: string[];
}> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  return {
    categories: listLocationCategories(deps.savedLocationRepo).map((row) => row.name),
    tags: listLocationTags(deps.savedLocationRepo).map((row) => row.name),
  };
}

// --- Building the library from existing entries --------------------------------------

export interface ImportPreviewResult extends ActionResult {
  /** Distinct places the import would create right now. */
  candidateCount?: number;
}

/**
 * How many places the import would add, without adding any.
 *
 * Read fresh rather than cached: it drops as batches run, and the view uses it
 * both to size the progress bar and to state the address-lookup time up front.
 */
export async function previewLocationImportAction(): Promise<ImportPreviewResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    return { ok: true, candidateCount: countImportCandidates(deps.savedLocationRepo) };
  } catch (error) {
    return toErrorResult(error, "Failed to scan the journal for locations.");
  }
}

export interface ImportBatchActionResult extends ActionResult {
  result?: ImportBatchResult;
}

/**
 * Creates the next batch of places from the journal's existing coordinates.
 *
 * Called repeatedly by the view so the progress bar moves and the run can be
 * stopped part way. Takes no offset — each call recomputes what is outstanding,
 * so batches cannot skip or duplicate rows, and stopping simply leaves the rest
 * for next time.
 */
export async function runLocationImportBatchAction(
  withAddresses: boolean,
): Promise<ImportBatchActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    const result = await runImportBatch(deps.savedLocationRepo, deps.geocodingClient, {
      withAddresses,
    });
    // Deliberately no revalidate per batch: a run is many calls, and
    // re-rendering the page under each one would fight the progress bar. The
    // view refreshes once when the whole run finishes.
    return { ok: true, result };
  } catch (error) {
    return toErrorResult(error, "Failed to import locations from the journal.");
  }
}

/** Refreshes the location screens once, after a run has finished or stopped. */
export async function finishLocationImportAction(): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  revalidateLocationScreens();
  return { ok: true };
}
