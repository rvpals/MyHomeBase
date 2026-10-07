"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { todayIsoLocal } from "@/lib/shared/date";
import { reverseGeocode, searchPlaces, type GeoPlace } from "@/lib/geocoding";
import { executeReadOnlyQuery } from "@/lib/sql-explorer";
import { isAdmin } from "@/lib/user";
import {
  clearCategoryIcon,
  clearTagIcon,
  createEncryptedEntry,
  createEntry,
  decryptEntry,
  type DecryptedEntryText,
  deleteCategory,
  deleteEntry,
  editEncryptedEntry,
  encryptEntry,
  removeEntryEncryption,
  deleteFilter,
  deleteTag,
  findAdjacentEntryDate,
  findEntries,
  withLogCondition,
  type JournalLogScope,
  generateCategoryIcon,
  generateMissingTaxonomyIcons,
  type GenerateIconsSummary,
  type TaxonomyKind,
  findUnusedTaxonomy,
  taxonomyInUseAmong,
  type TaxonomyUsage,
  mergeTaxonomy,
  planTaxonomyMerge,
  type TaxonomyMergePlan,
  type TaxonomyMergeResult,
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
  type AdjacentEntryDirection,
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
import { requireModuleAccess } from "../../require-access";
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

/** `ActionResult` plus the unused names, for the Meta Data "Clean up" scan. */
export interface UnusedTaxonomyResult extends ActionResult {
  /** Managed names no entry carries, as stored — what the view ticks. */
  names?: string[];
  /** Which of the names asked about are still in use, busiest first. */
  inUse?: TaxonomyUsage[];
}

/** `ActionResult` plus what a merge would do, for the dialog's live summary. */
export interface TaxonomyMergePlanResult extends ActionResult {
  plan?: TaxonomyMergePlan;
}

/** `ActionResult` plus what a completed merge did. */
export interface TaxonomyMergeActionResult extends ActionResult {
  result?: TaxonomyMergeResult;
}

/** `ActionResult` plus what a bulk taxonomy delete actually removed. */
export interface DeleteTaxonomyResult extends ActionResult {
  deleted?: number;
  /** Names that could not be deleted, each with why — the rest still went. */
  failures?: Array<{ name: string; error: string }>;
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
  /**
   * Set when the point was picked from the saved-location library rather than
   * dropped on the map. Recorded as provenance only — the coordinates and name
   * above are the entry's own copy. See migration 0101.
   */
  savedLocationId?: number;
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    setLocked(deps.journalRepo, id, isLocked);
  } catch (error) {
    return toErrorResult(error, "Failed to change the lock state.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  revalidatePath(`${JOURNAL_MODULE_PATH}/entries/${id}`);
  return { ok: true };
}

// --- encryption (migration 0131) ---------------------------------------------
//
// One password per entry, supplied on every operation and held nowhere. The
// password crosses the wire to these actions and is used to derive a key in
// `src/lib/journal/encryption.ts`; it is never written to the database, never
// logged, and never returned in an `ActionResult`.
//
// None of these revalidate with the decrypted text in hand — `revalidatePath`
// re-renders the server component, which reads the *encrypted* row, so nothing
// decrypted is ever cached.

/**
 * Creates an entry that is sealed from the moment it exists — the New Entry
 * screen's "Save entry encrypted".
 *
 * One action rather than create-then-encrypt from the client: two round trips
 * would write the plaintext title and content to disk in between, and a failure
 * after the first would leave an entry the writer believes is encrypted and
 * isn't.
 */
export async function createEncryptedJournalEntryAction(
  input: NewJournalEntryInput,
  password: string,
  hint: string,
): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    createEncryptedEntry(
      deps.journalRepo,
      {
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
      },
      password,
      hint,
    );
  } catch (error) {
    return toErrorResult(error, "Failed to save the encrypted entry.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

/** What `decryptJournalEntryAction` hands back on success. */
export interface DecryptEntryResult extends ActionResult {
  text?: DecryptedEntryText;
}

/**
 * Seals an entry under `password`. The hint is stored in the clear, so the form
 * that collects it warns against putting the password in it.
 */
export async function encryptJournalEntryAction(
  id: number,
  password: string,
  hint: string,
): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    encryptEntry(deps.journalRepo, id, password, hint);
  } catch (error) {
    return toErrorResult(error, "Failed to encrypt the entry.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  revalidatePath(`${JOURNAL_MODULE_PATH}/entries/${id}`);
  return { ok: true };
}

/**
 * Opens an entry for reading. **Writes nothing** — no revalidate, because
 * nothing on the server changed and a re-render would only re-read the
 * ciphertext this call just decrypted.
 */
export async function decryptJournalEntryAction(
  id: number,
  password: string,
): Promise<DecryptEntryResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    return { ok: true, text: decryptEntry(deps.journalRepo, id, password) };
  } catch (error) {
    return toErrorResult(error, "Failed to open the entry.");
  }
}

/**
 * Saves edited text back into an entry that stays encrypted.
 *
 * Separate from `updateJournalEntryAction` on purpose: that one carries the
 * whole aggregate and is the path every unencrypted edit takes, and it now
 * deliberately refuses to write plaintext over an encrypted entry. This is the
 * only way encrypted text changes.
 */
export async function updateEncryptedJournalEntryAction(
  id: number,
  password: string,
  text: DecryptedEntryText,
): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    editEncryptedEntry(deps.journalRepo, id, password, text);
  } catch (error) {
    return toErrorResult(error, "Failed to save the entry.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  revalidatePath(`${JOURNAL_MODULE_PATH}/entries/${id}`);
  return { ok: true };
}

/** Decrypts an entry permanently, restoring its plaintext title and content. */
export async function removeJournalEntryEncryptionAction(
  id: number,
  password: string,
): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    removeEntryEncryption(deps.journalRepo, id, password);
  } catch (error) {
    return toErrorResult(error, "Failed to remove encryption from the entry.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  revalidatePath(`${JOURNAL_MODULE_PATH}/entries/${id}`);
  return { ok: true };
}

// The use-case refuses to delete a locked entry, so a locked entry surfaces that
// error here rather than being silently skipped.
export async function deleteJournalEntryAction(id: number): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    upsertCategory(deps.journalRepo, input);
  } catch (error) {
    return toErrorResult(error, "Failed to save the category.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

export async function deleteJournalCategoryAction(name: string): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    await generateCategoryIcon(deps.journalRepo, name);
  } catch (error) {
    return toErrorResult(error, "Failed to generate the category icon.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

export async function clearJournalCategoryIconAction(name: string): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    upsertTag(deps.journalRepo, input);
  } catch (error) {
    return toErrorResult(error, "Failed to save the tag.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true };
}

export async function deleteJournalTagAction(name: string): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  let summary: GenerateIconsSummary;
  try {
    summary = await generateMissingTaxonomyIcons(deps.journalRepo, kind);
  } catch (error) {
    return toErrorResult(error, "Failed to generate the missing icons.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true, ...summary };
}

/**
 * The "Clean up" scan: which managed categories/tags no entry uses.
 *
 * Read-only on purpose — it deletes nothing and writes nothing. The view ticks
 * the names it returns and the reader presses Delete, so a mis-click on a
 * crowded screen can't quietly strip the taxonomy. No `revalidatePath` for the
 * same reason: nothing changed.
 */
export async function findUnusedJournalTaxonomyAction(
  kind: TaxonomyKind,
): Promise<UnusedTaxonomyResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    return { ok: true, names: findUnusedTaxonomy(deps.journalRepo, kind) };
  } catch (error) {
    return toErrorResult(error, "Failed to check which ones are unused.");
  }
}

/**
 * Which of `names` entries still carry — what the bulk-delete confirm reads out
 * before it detaches anything.
 *
 * Its own action rather than part of the delete: the reader sees the breakdown
 * and can still cancel, so the question has to be answerable without committing
 * to the write. Also read-only.
 */
export async function journalTaxonomyInUseAction(
  kind: TaxonomyKind,
  names: string[],
): Promise<UnusedTaxonomyResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    return { ok: true, inUse: taxonomyInUseAmong(deps.journalRepo, kind, names) };
  } catch (error) {
    return toErrorResult(error, "Failed to check which ones are still in use.");
  }
}

/**
 * Deletes several categories or tags at once — the Meta Data list's bulk Delete.
 *
 * Loops the same single-name use-case the per-row delete button uses, so each
 * name is removed from the managed list *and* detached from its entries in one
 * transaction, exactly as before. Deliberately not one big transaction across
 * all of them: a single bad name shouldn't roll back the other forty, and the
 * reader gets told which ones didn't go.
 */
export async function deleteJournalTaxonomyAction(
  kind: TaxonomyKind,
  names: string[],
): Promise<DeleteTaxonomyResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);

  let deleted = 0;
  const failures: Array<{ name: string; error: string }> = [];
  for (const name of names) {
    try {
      if (kind === "category") deleteCategory(deps.journalRepo, name);
      else deleteTag(deps.journalRepo, name);
      deleted += 1;
    } catch (error) {
      failures.push({
        name,
        error: error instanceof Error ? error.message : "Failed to delete it.",
      });
    }
  }

  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: failures.length === 0, deleted, failures };
}

/**
 * What merging the selected names into `target` would do — the numbers the
 * Merge dialog shows while the reader is still typing.
 *
 * Read-only, and separate from the merge itself so the dialog can update the
 * entry count and the "already exists" warning on each keystroke without
 * risking a write. No `revalidatePath`: nothing changed.
 */
export async function planJournalTaxonomyMergeAction(
  kind: TaxonomyKind,
  sources: string[],
  target: string,
): Promise<TaxonomyMergePlanResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    return { ok: true, plan: planTaxonomyMerge(deps.journalRepo, kind, { sources, target }) };
  } catch (error) {
    return toErrorResult(error, "Failed to work out what that merge would do.");
  }
}

/**
 * Folds the selected categories or tags into one name.
 *
 * **Not undoable** — there is no recycle bin for taxonomy, so which entry
 * carried which original name is gone once this lands. The UI confirms twice
 * before calling it.
 */
export async function mergeJournalTaxonomyAction(
  kind: TaxonomyKind,
  sources: string[],
  target: string,
): Promise<TaxonomyMergeActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  let result: TaxonomyMergeResult;
  try {
    result = mergeTaxonomy(deps.journalRepo, kind, { sources, target });
  } catch (error) {
    return toErrorResult(error, "Failed to merge them.");
  }
  revalidatePath(JOURNAL_MODULE_PATH);
  return { ok: true, result };
}

export async function clearJournalTagIconAction(name: string): Promise<ActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
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

/**
 * Runs a filter and returns the matching entries for the Entries browser.
 *
 * `scope` is which tab is asking, and the Log condition is applied here, on the
 * server, rather than trusted from the filter the client sent — so a re-query
 * can't be widened by a hand-shaped saved filter. Main passes `"all"`, the Log
 * tab `"only"`.
 */
export async function findJournalEntriesAction(
  filter: JournalFilter,
  scope: JournalLogScope,
): Promise<JournalEntriesResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    return {
      ok: true,
      entries: findEntries(
        deps.journalRepo,
        withLogCondition(filter, scope),
        ENTRIES_RESULT_LIMIT,
      ),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to apply the filter.");
  }
}

/** Saves a named filter, replacing any existing one with the same name. */
export async function saveJournalFilterAction(
  name: string,
  filter: JournalFilter,
): Promise<JournalFilterListResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    const trimmed = candidatePath?.trim() ?? "";
    const isCandidate = trimmed !== "";
    const path = isCandidate ? trimmed : configuredPhotoRoot();

    const diagnosis = await diagnosePhotoArchive(
      deps.photoFileStoreFor(path),
      // Today's date decides which year folder gets inspected in detail — recent years
      // are the ones most likely to be populated. Local calendar day, not the UTC
      // slice, which rolls to next year late on New Year's Eve.
      todayIsoLocal(),
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
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
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    return { ok: true, place: await reverseGeocode(deps.geocodingClient, { latitude, longitude }) };
  } catch (error) {
    return toErrorResult(error, "Reverse geocode failed.");
  }
}

export interface AdjacentEntryDateResult extends ActionResult {
  /** The neighbouring entry's date, or undefined when there is none that way. */
  date?: string;
}

/**
 * Backs the calendar's « » buttons: the nearest day with an entry before or
 * after the one the reader is looking at.
 *
 * A read the calendar screen can't do for itself — it holds one period's
 * entries, and the answer may be several periods away. "No entry that way" comes
 * back as `ok` with no date, not as an error: reaching the end of the journal is
 * a normal thing to do.
 */
export async function adjacentEntryDateAction(
  fromDate: string,
  direction: AdjacentEntryDirection,
): Promise<AdjacentEntryDateResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    return { ok: true, date: findAdjacentEntryDate(deps.journalRepo, { from: fromDate, direction }) };
  } catch (error) {
    return toErrorResult(error, "Could not find a neighbouring entry.");
  }
}
