import {
  decodeImageUpload,
  type DecodedImage,
  type ImageUploadInput,
} from "@/lib/shared/image-upload";
import { isSafeGeneratedIconSvg } from "./generated-icons";
import { fetchIconSvg } from "./icon-fetch";
import type { JournalRepository } from "./ports";
import {
  MAX_JOURNAL_ICON_BYTES,
  createEntrySchema,
  journalFilterSchema,
  saveJournalFilterSchema,
  updateEntrySchema,
  upsertCategorySchema,
  upsertTagSchema,
} from "./schema";
import type {
  CreateEntryInput,
  SaveJournalFilterInput,
  UpdateEntryInput,
  UpsertCategoryInput,
  UpsertTagInput,
} from "./schema";
import type {
  JournalCategory,
  JournalEntry,
  JournalEntryNeighbors,
  JournalFilter,
  JournalTag,
  JournalTaxonomyCount,
  JournalTaxonomyIcon,
  SavedJournalFilter,
  TodayInHistoryEntry,
} from "./types";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2}-\d{2})$/;

// Trims, drops blanks, and de-duplicates a list of category/tag names while
// preserving first-seen order. This is where an importer's raw split result
// ("tag1", " tag2 ", "tag1", "") becomes a clean ["tag1", "tag2"].
function normalizeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (name === "" || seen.has(name)) continue;
    seen.add(name);
    cleaned.push(name);
  }
  return cleaned;
}

export function listEntries(repo: JournalRepository): JournalEntry[] {
  return repo.listEntries();
}

/** The most recent entries, newest journal date first — for the module's overview list. */
export function listRecentEntries(repo: JournalRepository, limit = 25): JournalEntry[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`listRecentEntries: limit must be a positive integer, got ${limit}.`);
  }
  return repo.listRecentEntries(limit);
}

/**
 * Entries matching `term`, newest journal date first, up to `limit`. The term is
 * matched case-insensitively as a substring of an entry's date, time, title,
 * content, place, categories, or tags — the search box on the home screen.
 * A blank term matches nothing rather than dumping the whole journal.
 */
/**
 * Every entry dated in [startDate, endDate] inclusive, oldest first — what the
 * Calendar screen reads for the period it is showing.
 *
 * Unbounded on purpose: the caller has already bounded the query by choosing a
 * range, and a LIMIT here would silently blank the busiest days of a month
 * rather than the least interesting ones. Use the range to control the cost.
 */
export function listEntriesInDateRange(
  repo: JournalRepository,
  startDate: string,
  endDate: string,
): JournalEntry[] {
  if (!ISO_DATE_PATTERN.test(startDate)) {
    throw new Error(`listEntriesInDateRange: startDate must be YYYY-MM-DD, got "${startDate}".`);
  }
  if (!ISO_DATE_PATTERN.test(endDate)) {
    throw new Error(`listEntriesInDateRange: endDate must be YYYY-MM-DD, got "${endDate}".`);
  }
  // ISO dates compare lexicographically, so this needs no parsing. An inverted
  // range is a caller bug, not an empty result: BETWEEN would quietly return
  // nothing and look like "no entries that month".
  if (endDate < startDate) {
    throw new Error(
      `listEntriesInDateRange: endDate "${endDate}" is before startDate "${startDate}".`,
    );
  }
  return repo.listEntriesInDateRange(startDate, endDate);
}

export function searchEntries(repo: JournalRepository, term: string, limit = 25): JournalEntry[] {
  const trimmed = term.trim();
  if (trimmed === "") return [];
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`searchEntries: limit must be a positive integer, got ${limit}.`);
  }
  return repo.searchEntries(trimmed, limit);
}

/**
 * Entries matching a saved/structured filter, newest journal date first.
 *
 * Unlike `searchEntries`, a filter that narrows nothing returns **everything**
 * (up to `limit`) rather than nothing: the Entries browser's "All entries" option
 * is an empty filter, and a blank browse screen would be the wrong default there.
 */
export function findEntries(
  repo: JournalRepository,
  filter: JournalFilter,
  limit = 200,
): JournalEntry[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`findEntries: limit must be a positive integer, got ${limit}.`);
  }
  return repo.findEntries(journalFilterSchema.parse(filter), limit);
}

export function listFilters(repo: JournalRepository): SavedJournalFilter[] {
  return repo.listFilters();
}

export function getFilter(repo: JournalRepository, id: number): SavedJournalFilter | undefined {
  return repo.getFilterById(id);
}

/** Saves a named filter, replacing any existing one with the same name. */
export function saveFilter(
  repo: JournalRepository,
  input: SaveJournalFilterInput,
): SavedJournalFilter {
  return repo.saveFilter(saveJournalFilterSchema.parse(input));
}

export function deleteFilter(repo: JournalRepository, id: number): void {
  repo.deleteFilter(id);
}

export function getEntry(repo: JournalRepository, id: number): JournalEntry | undefined {
  return repo.getEntryById(id);
}

/**
 * The entries either side of `id` for previous/next navigation, in the same
 * order the entries list uses. `previous` is the older neighbour, `next` the
 * newer one; both are absent for an unknown id or at the ends of the journal.
 */
export function getEntryNeighbors(repo: JournalRepository, id: number): JournalEntryNeighbors {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`getEntryNeighbors: id must be a positive integer, got ${id}.`);
  }
  return repo.getEntryNeighbors(id);
}

/**
 * Entries from earlier years that fall on the same month and day as
 * `referenceDate` ("YYYY-MM-DD"), each paired with how many years ago it was.
 * The reference date is passed in rather than read from the clock so the result
 * is deterministic and testable.
 *
 * Entries in the reference year itself are excluded ("same month and day, but
 * not year"), as are any dated after it. Results are newest first, i.e.
 * ascending in yearsAgo. Note that on Feb 29 only other leap years can match.
 */
export function listTodayInHistory(
  repo: JournalRepository,
  referenceDate: string,
): TodayInHistoryEntry[] {
  const match = ISO_DATE_PATTERN.exec(referenceDate);
  if (!match) {
    throw new Error(`listTodayInHistory: referenceDate must be YYYY-MM-DD, got "${referenceDate}".`);
  }
  const referenceYear = Number(match[1]);
  const monthDay = match[2];

  return repo
    .listEntriesByMonthDay(monthDay)
    .map((entry) => ({ entry, yearsAgo: referenceYear - Number(entry.date.slice(0, 4)) }))
    .filter((candidate) => candidate.yearsAgo > 0)
    .sort((a, b) => a.yearsAgo - b.yearsAgo);
}

/**
 * Creates an entry with its categories, tags, and locations. Any referenced
 * category/tag that isn't in the managed lists yet is auto-registered first, so
 * imports never fail on unknown names.
 */
export function createEntry(repo: JournalRepository, input: CreateEntryInput): JournalEntry {
  const validated = createEntrySchema.parse(input);
  const categories = normalizeNames(validated.categories);
  const tags = normalizeNames(validated.tags);

  repo.registerCategoriesIfMissing(categories);
  repo.registerTagsIfMissing(tags);

  return repo.createEntry({ ...validated, categories, tags });
}

/**
 * Replaces an entry's contents. Refuses to touch a locked entry — the caller
 * must unlock it via setLocked first. Missing categories/tags are auto-registered
 * just like createEntry.
 */
export function updateEntry(
  repo: JournalRepository,
  id: number,
  input: UpdateEntryInput,
): JournalEntry {
  const existing = repo.getEntryById(id);
  if (!existing) throw new Error(`No journal entry with id ${id}.`);
  if (existing.isLocked) {
    throw new Error(`Journal entry ${id} is locked; unlock it before editing.`);
  }

  const validated = updateEntrySchema.parse(input);
  const categories = normalizeNames(validated.categories);
  const tags = normalizeNames(validated.tags);

  repo.registerCategoriesIfMissing(categories);
  repo.registerTagsIfMissing(tags);

  return repo.updateEntry(id, { ...validated, categories, tags });
}

/** Deletes an entry and its child rows. Refuses a locked entry, same as update. */
export function deleteEntry(repo: JournalRepository, id: number): void {
  const existing = repo.getEntryById(id);
  if (!existing) throw new Error(`No journal entry with id ${id}.`);
  if (existing.isLocked) {
    throw new Error(`Journal entry ${id} is locked; unlock it before deleting.`);
  }
  repo.deleteEntry(id);
}

export function setPinned(repo: JournalRepository, id: number, isPinned: boolean): JournalEntry {
  if (!repo.getEntryById(id)) throw new Error(`No journal entry with id ${id}.`);
  return repo.setEntryPinned(id, isPinned);
}

// Not blocked when the entry is locked — this is the only way to unlock one.
export function setLocked(repo: JournalRepository, id: number, isLocked: boolean): JournalEntry {
  if (!repo.getEntryById(id)) throw new Error(`No journal entry with id ${id}.`);
  return repo.setEntryLocked(id, isLocked);
}

export function listCategories(repo: JournalRepository): JournalCategory[] {
  return repo.listCategories();
}

export function upsertCategory(
  repo: JournalRepository,
  input: UpsertCategoryInput,
): JournalCategory {
  const validated = upsertCategorySchema.parse(input);
  return repo.upsertCategory(validated);
}

// Removing a category from the managed list also detaches it from every entry
// (the repository does both in one transaction).
export function deleteCategory(repo: JournalRepository, name: string): void {
  repo.deleteCategory(name);
}

/**
 * Stores the icon shown beside a category wherever it's listed. The category
 * must already exist — creating one as a side effect of an upload would let a
 * typo add a category nobody asked for.
 */
export function setCategoryIcon(
  repo: JournalRepository,
  name: string,
  input: ImageUploadInput,
): void {
  if (!repo.getCategoryByName(name)) throw new Error(`No category named "${name}".`);
  repo.setCategoryIcon(name, decodeImageUpload(input, MAX_JOURNAL_ICON_BYTES));
}

/** Removes a category's icon, leaving the category itself untouched. */
export function clearCategoryIcon(repo: JournalRepository, name: string): void {
  if (!repo.getCategoryByName(name)) throw new Error(`No category named "${name}".`);
  repo.setCategoryIcon(name, undefined);
}

/** Used only by the icon-serving route — never by anything rendering a list. */
export function getCategoryIcon(
  repo: JournalRepository,
  name: string,
): JournalTaxonomyIcon | undefined {
  return repo.getCategoryIcon(name);
}

export function listTags(repo: JournalRepository): JournalTag[] {
  return repo.listTags();
}

export function upsertTag(repo: JournalRepository, input: UpsertTagInput): JournalTag {
  const validated = upsertTagSchema.parse(input);
  return repo.upsertTag(validated);
}

// Removing a tag from the managed list also detaches it from every entry.
export function deleteTag(repo: JournalRepository, name: string): void {
  repo.deleteTag(name);
}

/** Stores the icon shown beside a tag wherever it's listed. Same rule as setCategoryIcon. */
export function setTagIcon(repo: JournalRepository, name: string, input: ImageUploadInput): void {
  if (!repo.getTagByName(name)) throw new Error(`No tag named "${name}".`);
  repo.setTagIcon(name, decodeImageUpload(input, MAX_JOURNAL_ICON_BYTES));
}

/** Removes a tag's icon, leaving the tag itself untouched. */
export function clearTagIcon(repo: JournalRepository, name: string): void {
  if (!repo.getTagByName(name)) throw new Error(`No tag named "${name}".`);
  repo.setTagIcon(name, undefined);
}

/**
 * Builds an icon for a name and returns it as storable bytes.
 *
 * Sources a real drawn glyph from the Iconify icon set when the name maps to one,
 * falling back to a locally drawn glyph (and finally a letter tile) offline or
 * when a name maps to nothing — so this never fails for want of a network.
 *
 * Deliberately not routed through `decodeImageUpload`: that validator's job is to
 * refuse a *user-supplied* image, and it excludes SVG precisely because uploaded
 * SVG served from our own origin is a stored-XSS vector. These bytes are either
 * ours or rewritten by us onto our own template, and `isSafeGeneratedIconSvg`
 * re-checks the exact string on its way to the DB — so the upload allowlist stays
 * closed while generated icons get their own, stricter check.
 */
async function buildFetchedIcon(name: string): Promise<DecodedImage> {
  const { svg, mimeType } = await fetchIconSvg(name);
  if (!isSafeGeneratedIconSvg(svg)) {
    throw new Error("The generated icon failed its safety check and was not saved.");
  }
  return { data: Buffer.from(svg, "utf8"), mimeType };
}

/**
 * Generates a category's icon from its name — the flash button in the
 * Categories & Tags editor.
 *
 * Replaces any existing icon, which is the point: the button is how you swap a
 * hand-uploaded icon for a generated one. The UI confirms first when there's
 * already an icon to lose.
 */
export async function generateCategoryIcon(repo: JournalRepository, name: string): Promise<void> {
  if (!repo.getCategoryByName(name)) throw new Error(`No category named "${name}".`);
  repo.setCategoryIcon(name, await buildFetchedIcon(name));
}

/** Generates a tag's icon from its name. Same rules as generateCategoryIcon. */
export async function generateTagIcon(repo: JournalRepository, name: string): Promise<void> {
  if (!repo.getTagByName(name)) throw new Error(`No tag named "${name}".`);
  repo.setTagIcon(name, await buildFetchedIcon(name));
}

/** What a batch icon fill did. */
export interface GenerateIconsSummary {
  generated: number;
  failed: number;
}

/** Which lists a batch icon fill should cover. Omit for both. */
export type TaxonomyKind = "category" | "tag";

/**
 * Fills in an icon for every category and tag that hasn't got one, or for just
 * one of the two lists when `kind` says so.
 *
 * Exists because the per-row button doesn't scale: a real journal accumulates
 * a couple of hundred tags, and none of them start with an icon. Missing-only by
 * design — a hand-uploaded icon is a deliberate choice and this must not
 * silently replace it; the per-row button is still how you overwrite one.
 *
 * Sequential rather than parallel: this is a courtesy to a free public API, and
 * the whole run is a background click, not something a reader waits on.
 */
export async function generateMissingTaxonomyIcons(
  repo: JournalRepository,
  kind?: TaxonomyKind,
): Promise<GenerateIconsSummary> {
  let generated = 0;
  let failed = 0;

  if (kind !== "tag") {
    for (const category of repo.listCategories()) {
      if (category.iconMimeType) continue;
      try {
        repo.setCategoryIcon(category.name, await buildFetchedIcon(category.name));
        generated += 1;
      } catch {
        // One bad name shouldn't abandon the other 200.
        failed += 1;
      }
    }
  }

  if (kind !== "category") {
    for (const tag of repo.listTags()) {
      if (tag.iconMimeType) continue;
      try {
        repo.setTagIcon(tag.name, await buildFetchedIcon(tag.name));
        generated += 1;
      } catch {
        failed += 1;
      }
    }
  }

  return { generated, failed };
}

/** Used only by the icon-serving route — never by anything rendering a list. */
export function getTagIcon(repo: JournalRepository, name: string): JournalTaxonomyIcon | undefined {
  return repo.getTagIcon(name);
}

/** The most-used tags across all entries, highest count first, up to `limit`. */
export function listTopTags(repo: JournalRepository, limit = 10): JournalTaxonomyCount[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`listTopTags: limit must be a positive integer, got ${limit}.`);
  }
  return repo.listTopTags(limit);
}

/** The most-used categories across all entries, highest count first, up to `limit`. */
export function listTopCategories(repo: JournalRepository, limit = 10): JournalTaxonomyCount[] {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`listTopCategories: limit must be a positive integer, got ${limit}.`);
  }
  return repo.listTopCategories(limit);
}
