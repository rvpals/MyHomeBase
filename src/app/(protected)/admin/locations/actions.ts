"use server";

// Server actions for the application-wide saved-location library, behind
// Admin → Locations. Thin adapters: authorise, hand the raw input to a
// `lib/sys-locations` use-case (which validates it with its own zod schema),
// revalidate, return.
//
// Copied from the Journal's journal-locations-actions.ts, minus the two actions
// that read jrn_entry_* tables (the "which entries use this?" popup and the
// importer). These places belong to no module, so neither does this file.
//
// requireAdmin() rather than requireModuleAccess(): these screens live under
// Admin, which is not a registered module.

import { revalidatePath } from "next/cache";
import {
  clearLocationTaxonomyIcon,
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
  saveLocationTaxonomy,
  searchSavedLocations,
  setLocationTaxonomyIcon,
  updateSavedLocation,
  type LocationIconFillSummary,
  type LocationSearchInput,
  type LocationTaxonomyKind,
  type PromoteLocationInput,
  type SaveLocationInput,
  type SavedLocationWithUsage,
  type UpdateLocationInput,
  type UpsertLocationTaxonomyInput,
} from "@/lib/sys-locations";
import { findLocationsAtCoordinates, listSavedLocations, type SavedLocation } from "@/lib/sys-locations";
import { reverseGeocode, searchPlaces, type GeoPlace } from "@/lib/geocoding";
import { deps } from "@/lib/wiring";
import { requireAdmin } from "@/app/(protected)/require-access";

const LOCATIONS_PATH = "/admin/locations";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/**
 * Revalidates all three screens that read the library.
 *
 * All three, not just the one the reader is on: saving a place from the manager
 * has to change what the map draws, and a stale map is the failure that would
 * go unnoticed longest.
 */
function revalidateLocationScreens(): void {
  revalidatePath(`${LOCATIONS_PATH}/manager`);
  revalidatePath(`${LOCATIONS_PATH}/map`);
  revalidatePath(`${LOCATIONS_PATH}/metadata`);
}

export interface SavedLocationsResult extends ActionResult {
  locations?: SavedLocationWithUsage[];
}

/**
 * The places matching a query and/or filters.
 *
 * An action rather than a page read because both callers narrow the list
 * interactively — the manager and the map, as filter chips are toggled.
 */
export async function searchSavedLocationsAction(
  input: LocationSearchInput,
): Promise<SavedLocationsResult> {
  await requireAdmin();
  try {
    return { ok: true, locations: searchSavedLocations(deps.sysLocationRepo, input) };
  } catch (error) {
    return toErrorResult(error, "Failed to search saved locations.");
  }
}

export async function createSavedLocationAction(
  input: SaveLocationInput,
): Promise<ActionResult> {
  await requireAdmin();
  try {
    createSavedLocation(deps.sysLocationRepo, input);
  } catch (error) {
    return toErrorResult(error, "Failed to save the location.");
  }
  revalidateLocationScreens();
  return { ok: true };
}

export async function updateSavedLocationAction(
  input: UpdateLocationInput,
): Promise<ActionResult> {
  await requireAdmin();
  try {
    updateSavedLocation(deps.sysLocationRepo, input);
  } catch (error) {
    return toErrorResult(error, "Failed to update the location.");
  }
  revalidateLocationScreens();
  return { ok: true };
}

/**
 * Retires a place from the library.
 *
 * Nothing references these places yet, so no usage warning applies — see
 * migration 0140.
 */
export async function deleteSavedLocationAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  try {
    deleteSavedLocation(deps.sysLocationRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete the location.");
  }
  revalidateLocationScreens();
  return { ok: true };
}

/** Creates a library row from a bare point. */
export async function promoteToSavedLocationAction(
  input: PromoteLocationInput,
): Promise<ActionResult> {
  await requireAdmin();
  try {
    promoteToSavedLocation(deps.sysLocationRepo, input);
  } catch (error) {
    return toErrorResult(error, "Failed to add the location to the library.");
  }
  revalidateLocationScreens();
  return { ok: true };
}

export async function saveLocationTaxonomyAction(
  kind: LocationTaxonomyKind,
  input: UpsertLocationTaxonomyInput,
): Promise<ActionResult> {
  await requireAdmin();
  try {
    saveLocationTaxonomy(deps.sysLocationRepo, kind, input);
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
  await requireAdmin();
  try {
    deleteLocationTaxonomy(deps.sysLocationRepo, kind, name);
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
  await requireAdmin();
  try {
    setLocationTaxonomyIcon(deps.sysLocationRepo, kind, name, {
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
  await requireAdmin();
  try {
    clearLocationTaxonomyIcon(deps.sysLocationRepo, kind, name);
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
  await requireAdmin();
  try {
    await generateLocationTaxonomyIcon(deps.sysLocationRepo, kind, name);
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
  await requireAdmin();
  let summary: LocationIconFillSummary;
  try {
    summary = await generateMissingLocationTaxonomyIcons(deps.sysLocationRepo);
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
  await requireAdmin();
  try {
    return {
      ok: true,
      categories: countLocationsByCategory(deps.sysLocationRepo),
      tags: countLocationsByTag(deps.sysLocationRepo),
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
  await requireAdmin();
  return {
    categories: listLocationCategories(deps.sysLocationRepo).map((row) => row.name),
    tags: listLocationTags(deps.sysLocationRepo).map((row) => row.name),
  };
}

// --- Geocoding -----------------------------------------------------------------
//
// The Journal has identical actions in journal-actions.ts, but those authorise
// with requireModuleAccess("journal"): an admin without the Journal module
// would be refused by them. Same use-cases, this screen's own gate.

export interface GeoSearchResult extends ActionResult {
  places?: GeoPlace[];
}

/** Free-text place or street-address search, for the map picker. */
export async function searchPlacesAction(query: string): Promise<GeoSearchResult> {
  await requireAdmin();
  try {
    return { ok: true, places: await searchPlaces(deps.geocodingClient, { query }) };
  } catch (error) {
    return toErrorResult(error, "Place search failed.");
  }
}

export interface ReverseGeocodeResult extends ActionResult {
  place?: GeoPlace;
}

/** The address at a point, for the picker's "Look up" button. */
export async function reverseGeocodeAction(
  latitude: number,
  longitude: number,
): Promise<ReverseGeocodeResult> {
  await requireAdmin();
  try {
    return { ok: true, place: await reverseGeocode(deps.geocodingClient, { latitude, longitude }) };
  } catch (error) {
    return toErrorResult(error, "Reverse geocode failed.");
  }
}

// --- The duplicate-coordinate warning ------------------------------------------

export interface LocationsAtPointResult extends ActionResult {
  locations?: SavedLocation[];
}

/**
 * The saved places already at a point, for the editor's "we already have this
 * location" warning.
 *
 * A warning, never a block: two shops can share an address, and a reader who
 * means to save both must be able to. The write actions do not consult this —
 * enforcing it there would turn a prompt into a rule.
 *
 * Checked at save time rather than as the pin moves: a lookup on every drag
 * would read the whole library per frame to answer a question the reader has
 * not asked yet.
 *
 * `excludeId` is the row being edited, so a place never warns about itself.
 */
export async function findLocationsAtPointAction(
  latitude: number,
  longitude: number,
  excludeId?: number,
): Promise<LocationsAtPointResult> {
  await requireAdmin();
  try {
    return {
      ok: true,
      locations: findLocationsAtCoordinates(
        listSavedLocations(deps.sysLocationRepo),
        { latitude, longitude },
        excludeId,
      ),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to check for existing locations here.");
  }
}
