import type { EntryWriteData, UpsertCategoryInput, UpsertTagInput } from "./schema";
import type {
  JournalCategory,
  JournalEntry,
  JournalEntryNeighbors,
  JournalTag,
  JournalTaxonomyCount,
} from "./types";

// The interface a journal use-case depends on. The real SQLite implementation
// is wired in at wiring.ts; tests wire in an in-memory fake. Use-cases never see
// the concrete class.
export interface JournalRepository {
  // Entries — each create/update/delete writes the entry and its child rows
  // (categories, tags, locations) in a single transaction.
  listEntries(): JournalEntry[];
  /** The most recent `limit` entries, newest journal date first. */
  listRecentEntries(limit: number): JournalEntry[];
  /**
   * Every entry whose date falls on the given month and day, in any year,
   * newest first. `monthDay` is "MM-DD".
   */
  listEntriesByMonthDay(monthDay: string): JournalEntry[];
  /**
   * Entries whose date, time, title, content, place, categories, or tags match
   * `term` as a case-insensitive substring, newest journal date first, up to
   * `limit`. Empty/blank terms return [].
   */
  searchEntries(term: string, limit: number): JournalEntry[];
  getEntryById(id: number): JournalEntry | undefined;
  /**
   * The entries immediately older and newer than `entryId` in (entry_date,
   * entry_time, id) order. Both are absent if the entry itself doesn't exist.
   */
  getEntryNeighbors(entryId: number): JournalEntryNeighbors;
  createEntry(input: EntryWriteData): JournalEntry;
  updateEntry(id: number, input: EntryWriteData): JournalEntry;
  deleteEntry(id: number): void;
  setEntryPinned(id: number, isPinned: boolean): JournalEntry;
  setEntryLocked(id: number, isLocked: boolean): JournalEntry;

  // Managed category list.
  listCategories(): JournalCategory[];
  getCategoryByName(name: string): JournalCategory | undefined;
  upsertCategory(input: UpsertCategoryInput): JournalCategory;
  /** Deletes the category and detaches it from every entry, in one transaction. */
  deleteCategory(name: string): void;

  // Managed tag list.
  listTags(): JournalTag[];
  getTagByName(name: string): JournalTag | undefined;
  upsertTag(input: UpsertTagInput): JournalTag;
  /** Deletes the tag and detaches it from every entry, in one transaction. */
  deleteTag(name: string): void;

  // Insert-if-absent for names referenced by an entry, so saving/importing an
  // entry never fails on an unknown category/tag. Existing rows are left as-is
  // (descriptions are preserved).
  registerCategoriesIfMissing(names: string[]): void;
  registerTagsIfMissing(names: string[]): void;

  // The most-used tags/categories across all entries, highest count first, up to
  // `limit` — for the "Top Tags" / "Top Categories" lists.
  listTopTags(limit: number): JournalTaxonomyCount[];
  listTopCategories(limit: number): JournalTaxonomyCount[];
}
