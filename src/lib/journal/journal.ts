import type { JournalRepository } from "./ports";
import {
  createEntrySchema,
  updateEntrySchema,
  upsertCategorySchema,
  upsertTagSchema,
} from "./schema";
import type {
  CreateEntryInput,
  UpdateEntryInput,
  UpsertCategoryInput,
  UpsertTagInput,
} from "./schema";
import type {
  JournalCategory,
  JournalEntry,
  JournalEntryNeighbors,
  JournalTag,
  JournalTaxonomyCount,
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
