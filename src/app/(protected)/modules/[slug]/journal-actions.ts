"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { reverseGeocode, searchPlaces, type GeoPlace } from "@/lib/geocoding";
import { executeReadOnlyQuery } from "@/lib/sql-explorer";
import { isAdmin } from "@/lib/user";
import {
  createEntry,
  deleteEntry,
  journalPreferencesToEntries,
  searchEntries,
  setLocked,
  updateEntry,
  type JournalEntry,
  type JournalPreferences,
} from "@/lib/journal";
import { getModuleBySlug } from "@/lib/modules";
import { saveModuleSettings } from "@/lib/module-settings";
import { getCurrentWeather, type CurrentWeather, type TemperatureUnit } from "@/lib/weather";
import { deps } from "@/lib/wiring";

const JOURNAL_MODULE_PATH = "/modules/journal";
const JOURNAL_MODULE_SLUG = "journal";
const SEARCH_RESULT_LIMIT = 50;

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
