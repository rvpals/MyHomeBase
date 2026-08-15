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

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

// The raw text the New Journal form collects. Categories/tags come as delimited
// strings (comma / whitespace) matching how the import treats them; createEntry
// trims, de-dupes, and auto-registers the individual names.
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
  categoriesText: string;
  tagsText: string;
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
      categories: input.categoriesText.split(","),
      tags: input.tagsText.split(/\s+/),
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
      categories: input.categoriesText.split(","),
      tags: input.tagsText.split(/\s+/),
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
