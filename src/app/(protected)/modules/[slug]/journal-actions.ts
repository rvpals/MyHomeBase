"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { reverseGeocode, searchPlaces, type GeoPlace } from "@/lib/geocoding";
import { executeReadOnlyQuery } from "@/lib/sql-explorer";
import { isAdmin } from "@/lib/user";
import {
  clearCategoryIcon,
  clearTagIcon,
  createEntry,
  deleteCategory,
  deleteEntry,
  deleteFilter,
  deleteTag,
  findEntries,
  generateCategoryIcon,
  generateMissingTaxonomyIcons,
  type GenerateIconsSummary,
  type TaxonomyKind,
  generateTagIcon,
  journalPreferencesToEntries,
  listFilters,
  saveFilter,
  searchEntries,
  setCategoryIcon,
  setLocked,
  setTagIcon,
  updateEntry,
  upsertCategory,
  upsertTag,
  type JournalEntry,
  type JournalFilter,
  type JournalPreferences,
  type SavedJournalFilter,
  type UpsertCategoryInput,
  type UpsertTagInput,
} from "@/lib/journal";
import { getModuleBySlug } from "@/lib/modules";
import { saveModuleSettings } from "@/lib/module-settings";
import type { ImageUploadInput } from "@/lib/shared/image-upload";
import { getCurrentWeather, type CurrentWeather, type TemperatureUnit } from "@/lib/weather";
import { deps } from "@/lib/wiring";
import { diagnosePhotoArchive, type PhotoArchiveDiagnosis } from "@/lib/journal-photos";
import { configuredPhotoRoot, isPhotoRootFromSetting } from "./journal-photo-root";

const JOURNAL_MODULE_PATH = "/modules/journal";
const JOURNAL_MODULE_SLUG = "journal";
const SEARCH_RESULT_LIMIT = 50;
// Higher than search's cap: this is a browse screen, and DataGrid paginates
// whatever it's handed rather than rendering all of it at once.
const ENTRIES_RESULT_LIMIT = 500;

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** `ActionResult` plus the counts, for the batch icon fill. */
export interface GenerateIconsResult extends ActionResult {
  generated?: number;
  failed?: number;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

// What the New Journal form collects. Categories and tags arrive as arrays —
// the form picks them one at a time, so there is no delimited string to parse
// here. createEntry still trims, de-dupes, and auto-registers each name, which
// is what lets a name typed into the picker become a real category or tag.
export interface JournalLocationInput {
  latitude: number;
  longitude: number;
  locationName: string;
}

export interface EntryWeatherInput {
  temp: number;
  unit: string;
  description: string;
  code: number;
}

export interface NewJournalEntryInput {
  date: string;
  time: string;
  title: string;
  content: string;
  placeName: string;
  categories: string[];
  tags: string[];
  locations: JournalLocationInput[];
  weather?: EntryWeatherInput;
  isPinned?: boolean;
}

export async function createJournalEntryAction(input: NewJournalEntryInput): Promise<ActionResult> {
  try {
    createEntry(deps.journalRepo, {
      date: input.date,
      time: input.time,
      title: input.title,
      content: input.content,
      placeName: input.placeName,
      categories: input.categories,
      tags: input.tags,
      locations: input.locations,
      weather: input.weather,
      isPinned: input.isPinned ?? false,
    });
  } catch (error) {
    return toErrorResult(error, "Failed to save entry.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

/**
 * Replaces an entry's contents. `updateEntry` rewrites the whole aggregate, so
 * the caller must resubmit weather, locations, and isPinned — the edit form seeds
 * them from the current entry so editing text doesn't quietly drop them. A locked
 * entry is rejected by the use-case.
 */
export async function updateJournalEntryAction(
  id: number,
  input: NewJournalEntryInput,
): Promise<ActionResult> {
  try {
    updateEntry(deps.journalRepo, id, {
      date: input.date,
      time: input.time,
      title: input.title,
      content: input.content,
      placeName: input.placeName,
      categories: input.categories,
      tags: input.tags,
      locations: input.locations,
      weather: input.weather,
      isPinned: input.isPinned ?? false,
    });
  } catch (error) {
    return toErrorResult(error, "Failed to update the entry.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  revalidatePath(`${JOURNAL_MODULE_PATH}/entries/${id}`);
  return { ok: true };
}

export async function setEntryLockAction(id: number, isLocked: boolean): Promise<ActionResult> {
  try {
    setLocked(deps.journalRepo, id, isLocked);
  } catch (error) {
    return toErrorResult(error, "Failed to change the lock state.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  revalidatePath(`${JOURNAL_MODULE_PATH}/entries/${id}`);
  return { ok: true };
}

// The use-case refuses to delete a locked entry, so a locked entry surfaces that
// error here rather than being silently skipped.
export async function deleteJournalEntryAction(id: number): Promise<ActionResult> {
  try {
    deleteEntry(deps.journalRepo, id);
  } catch (error) {
    return toErrorResult(error, "Failed to delete the entry.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

// --- categories --------------------------------------------------------------

export async function saveJournalCategoryAction(input: UpsertCategoryInput): Promise<ActionResult> {
  try {
    upsertCategory(deps.journalRepo, input);
  } catch (error) {
    return toErrorResult(error, "Failed to save the category.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

export async function deleteJournalCategoryAction(name: string): Promise<ActionResult> {
  try {
    deleteCategory(deps.journalRepo, name);
  } catch (error) {
    return toErrorResult(error, "Failed to delete the category.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

/**
 * Stores a category's icon. Base64 rather than raw bytes for the same reason as
 * every other image upload in the app: it survives server-action serialization
 * cleanly, and the use-case decodes it and enforces the type and size limits.
 */
export async function saveJournalCategoryIconAction(
  name: string,
  mimeType: string,
  base64Data: string,
): Promise<ActionResult> {
  try {
    setCategoryIcon(deps.journalRepo, name, { mimeType, base64Data } as ImageUploadInput);
  } catch (error) {
    return toErrorResult(error, "Failed to save the category icon.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

/**
 * Generates a category's icon from its name — the flash button in the editor.
 *
 * Takes only the name: the drawing happens on the server from our own template,
 * so there are no bytes to ship up and nothing the caller could substitute.
 */
export async function generateJournalCategoryIconAction(name: string): Promise<ActionResult> {
  try {
    await generateCategoryIcon(deps.journalRepo, name);
  } catch (error) {
    return toErrorResult(error, "Failed to generate the category icon.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

export async function clearJournalCategoryIconAction(name: string): Promise<ActionResult> {
  try {
    clearCategoryIcon(deps.journalRepo, name);
  } catch (error) {
    return toErrorResult(error, "Failed to remove the category icon.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

// --- tags ----------------------------------------------------------------

export async function saveJournalTagAction(input: UpsertTagInput): Promise<ActionResult> {
  try {
    upsertTag(deps.journalRepo, input);
  } catch (error) {
    return toErrorResult(error, "Failed to save the tag.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

export async function deleteJournalTagAction(name: string): Promise<ActionResult> {
  try {
    deleteTag(deps.journalRepo, name);
  } catch (error) {
    return toErrorResult(error, "Failed to delete the tag.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

export async function saveJournalTagIconAction(
  name: string,
  mimeType: string,
  base64Data: string,
): Promise<ActionResult> {
  try {
    setTagIcon(deps.journalRepo, name, { mimeType, base64Data } as ImageUploadInput);
  } catch (error) {
    return toErrorResult(error, "Failed to save the tag icon.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

/** Generates a tag's icon from its name. Same shape as the category version. */
export async function generateJournalTagIconAction(name: string): Promise<ActionResult> {
  try {
    await generateTagIcon(deps.journalRepo, name);
  } catch (error) {
    return toErrorResult(error, "Failed to generate the tag icon.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

/**
 * Fills in an icon for every category and tag that hasn't got one — or for just
 * one of the two lists when `kind` is given, which is what the per-list
 * "Autopopulate icon" button uses.
 *
 * Separate from the per-row button because a real journal has hundreds of tags
 * and none of them start with an icon — clicking through them one at a time
 * isn't a workflow. Skips anything that already has an icon.
 */
export async function generateMissingJournalIconsAction(
  kind?: TaxonomyKind,
): Promise<GenerateIconsResult> {
  let summary: GenerateIconsSummary;
  try {
    summary = await generateMissingTaxonomyIcons(deps.journalRepo, kind);
  } catch (error) {
    return toErrorResult(error, "Failed to generate the missing icons.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true, ...summary };
}

export async function clearJournalTagIconAction(name: string): Promise<ActionResult> {
  try {
    clearTagIcon(deps.journalRepo, name);
  } catch (error) {
    return toErrorResult(error, "Failed to remove the tag icon.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

// --- saved entry filters -----------------------------------------------------

export interface JournalFilterListResult extends ActionResult {
  filters?: SavedJournalFilter[];
}

export interface JournalEntriesResult extends ActionResult {
  entries?: JournalEntry[];
}

/** Runs a filter and returns the matching entries for the Entries browser. */
export async function findJournalEntriesAction(
  filter: JournalFilter,
): Promise<JournalEntriesResult> {
  try {
    return { ok: true, entries: findEntries(deps.journalRepo, filter, ENTRIES_RESULT_LIMIT) };
  } catch (error) {
    return toErrorResult(error, "Failed to apply the filter.");
  }
}

/** Saves a named filter, replacing any existing one with the same name. */
export async function saveJournalFilterAction(
  name: string,
  filter: JournalFilter,
): Promise<JournalFilterListResult> {
  try {
    saveFilter(deps.journalRepo, { name, filter });
    // The caller re-renders the dropdown from this, so hand back the new list
    // rather than making it round-trip again.
    const filters = listFilters(deps.journalRepo);
    revalidatePath(JOURNAL_MODULE_PATH);
    return { ok: true, filters };
  } catch (error) {
    return toErrorResult(error, "Failed to save the filter.");
  }
}

export async function deleteJournalFilterAction(id: number): Promise<JournalFilterListResult> {
  try {
    deleteFilter(deps.journalRepo, id);
    const filters = listFilters(deps.journalRepo);
    revalidatePath(JOURNAL_MODULE_PATH);
    return { ok: true, filters };
  } catch (error) {
    return toErrorResult(error, "Failed to delete the filter.");
  }
}

export interface WeatherResult extends ActionResult {
  weather?: CurrentWeather;
}

export interface JournalSearchResult extends ActionResult {
  entries?: JournalEntry[];
}

/** The home screen's search: matches date, time, title, content, place, category, and tag. */
export async function searchJournalEntriesAction(term: string): Promise<JournalSearchResult> {
  try {
    return { ok: true, entries: searchEntries(deps.journalRepo, term, SEARCH_RESULT_LIMIT) };
  } catch (error) {
    return toErrorResult(error, "Search failed.");
  }
}

export async function fetchWeatherAction(
  latitude: number,
  longitude: number,
  unit: TemperatureUnit,
): Promise<WeatherResult> {
  try {
    return { ok: true, weather: await getCurrentWeather(deps.weatherClient, { latitude, longitude, unit }) };
  } catch (error) {
    return toErrorResult(error, "Failed to fetch weather.");
  }
}

export interface JournalSqlResult extends ActionResult {
  columns?: string[];
  rows?: unknown[][];
}

/**
 * Runs the journal grid's "Show SQL" query. Restricted to admins and to SELECT
 * statements: a read-only query can still read every table (password hashes,
 * sessions), so the role check is enforced here on the server — the view's
 * `canRunSql` prop only hides the button and is not a security boundary.
 */
export async function runJournalSqlAction(sql: string): Promise<JournalSqlResult> {
  try {
    const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
    if (!currentUser || !isAdmin(currentUser)) {
      return { ok: false, error: "Running SQL requires an administrator account." };
    }

    const result = executeReadOnlyQuery(deps.sqlExplorerRepo, sql);
    return { ok: true, columns: result.columns, rows: result.rows };
  } catch (error) {
    return toErrorResult(error, "Failed to run the query.");
  }
}

export async function saveJournalPreferencesAction(
  preferences: JournalPreferences,
): Promise<ActionResult> {
  try {
    const journalModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
    if (!journalModule) return { ok: false, error: "Journal module not found." };
    saveModuleSettings(deps.moduleSettingsRepo, {
      moduleId: journalModule.id,
      entries: journalPreferencesToEntries(preferences),
    });
  } catch (error) {
    return toErrorResult(error, "Failed to save preferences.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

export interface PhotoAccessResult extends ActionResult {
  diagnosis?: PhotoArchiveDiagnosis;
  /** The path that was checked, and whether it came from the setting or the environment. */
  checkedPath?: string;
  isFromSetting?: boolean;
}

/**
 * The Configuration screen's "Check Access" button.
 *
 * Reports what the app can actually see at the configured path — the folders it found,
 * not just a pass/fail — because the failure this exists to diagnose looked identical
 * whether the path was wrong, the volume was wrong, or the share was simply not readable
 * by the user the app runs as.
 *
 * Takes the path as an argument so the screen can test a value the admin has typed but
 * not yet saved; omit it to check what is currently stored.
 */
export async function checkPhotoAccessAction(candidatePath?: string): Promise<PhotoAccessResult> {
  try {
    const trimmed = candidatePath?.trim() ?? "";
    const isCandidate = trimmed !== "";
    const path = isCandidate ? trimmed : configuredPhotoRoot();

    const diagnosis = await diagnosePhotoArchive(
      deps.photoFileStoreFor(path),
      // Today's date decides which year folder gets inspected in detail — recent years
      // are the ones most likely to be populated.
      new Date().toISOString().slice(0, 10),
    );

    return {
      ok: true,
      diagnosis,
      checkedPath: path,
      isFromSetting: isCandidate || isPhotoRootFromSetting(),
    };
  } catch (error) {
    return toErrorResult(error, "Could not check the photo folder.");
  }
}

export interface GeoSearchResult extends ActionResult {
  places?: GeoPlace[];
}

export async function searchPlacesAction(query: string): Promise<GeoSearchResult> {
  try {
    return { ok: true, places: await searchPlaces(deps.geocodingClient, { query }) };
  } catch (error) {
    return toErrorResult(error, "Place search failed.");
  }
}

export interface ReverseGeocodeResult extends ActionResult {
  place?: GeoPlace;
}

export async function reverseGeocodeAction(
  latitude: number,
  longitude: number,
): Promise<ReverseGeocodeResult> {
  try {
    return { ok: true, place: await reverseGeocode(deps.geocodingClient, { latitude, longitude }) };
  } catch (error) {
    return toErrorResult(error, "Reverse geocode failed.");
  }
}
