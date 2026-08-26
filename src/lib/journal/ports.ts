import type {
  EntryWriteData,
  JournalFilterWriteData,
  PrefillTemplateWriteData,
  UpsertCategoryInput,
  UpsertTagInput,
} from "./schema";
import type {
  JournalCategory,
  JournalEntry,
  JournalEntryNeighbors,
  JournalFilter,
  JournalPrefillField,
  JournalPrefillTemplate,
  JournalTag,
  JournalTaxonomyCount,
  JournalTaxonomyIcon,
  SavedJournalFilter,
} from "./types";
import type { DecodedImage } from "@/lib/shared/image-upload";

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
   * Every entry whose date falls in [startDate, endDate] inclusive, oldest
   * first. Both bounds are "YYYY-MM-DD". Unlike listEntriesByMonthDay this is a
   * range on the raw column, so it uses idx_jrn_entries_entry_date.
   */
  listEntriesInDateRange(startDate: string, endDate: string): JournalEntry[];
  /**
   * Entries whose date, time, title, content, place, categories, or tags match
   * `term` as a case-insensitive substring, newest journal date first, up to
   * `limit`. Empty/blank terms return [].
   */
  searchEntries(term: string, limit: number): JournalEntry[];
  /**
   * Entries matching a structured filter, newest journal date first, up to
   * `limit`. An empty filter (nothing that narrows) returns the same thing
   * `listRecentEntries` would.
   */
  findEntries(filter: JournalFilter, limit: number): JournalEntry[];
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
  /** Used only by the icon-serving route — never by anything rendering a list. */
  getCategoryIcon(name: string): JournalTaxonomyIcon | undefined;
  /** `undefined` clears the icon, leaving the category itself untouched. */
  setCategoryIcon(name: string, icon: DecodedImage | undefined): void;

  // Managed tag list.
  listTags(): JournalTag[];
  getTagByName(name: string): JournalTag | undefined;
  upsertTag(input: UpsertTagInput): JournalTag;
  /** Deletes the tag and detaches it from every entry, in one transaction. */
  deleteTag(name: string): void;
  /** Used only by the icon-serving route — never by anything rendering a list. */
  getTagIcon(name: string): JournalTaxonomyIcon | undefined;
  /** `undefined` clears the icon, leaving the tag itself untouched. */
  setTagIcon(name: string, icon: DecodedImage | undefined): void;

  // Saved entry filters for the Entries browser. `saveFilter` is an upsert by
  // name (UNIQUE (name) — migration 0043), so there's no separate create/update.
  listFilters(): SavedJournalFilter[];
  getFilterById(id: number): SavedJournalFilter | undefined;
  saveFilter(input: JournalFilterWriteData): SavedJournalFilter;
  deleteFilter(id: number): void;

  // Insert-if-absent for names referenced by an entry, so saving/importing an
  // entry never fails on an unknown category/tag. Existing rows are left as-is
  // (descriptions are preserved).
  registerCategoriesIfMissing(names: string[]): void;
  registerTagsIfMissing(names: string[]): void;

  // The most-used tags/categories across all entries, highest count first, up to
  // `limit` — for the "Top Tags" / "Top Categories" lists.
  listTopTags(limit: number): JournalTaxonomyCount[];
  listTopCategories(limit: number): JournalTaxonomyCount[];

  // Prefill templates (migration 0062). `savePrefillTemplate` covers both create
  // and update — the input carries an optional id — because the editor is one
  // form either way and a split would duplicate its validation.
  listPrefillTemplates(): JournalPrefillTemplate[];
  getPrefillTemplateById(id: number): JournalPrefillTemplate | undefined;
  getPrefillTemplateByName(name: string): JournalPrefillTemplate | undefined;
  savePrefillTemplate(input: PrefillTemplateWriteData): JournalPrefillTemplate;
  deletePrefillTemplate(id: number): void;
  setPrefillTemplateEnabled(id: number, isEnabled: boolean): JournalPrefillTemplate;

  /**
   * The distinct values already used for one prefill-able field, most-used first,
   * up to `limit` — the autocomplete list behind the template editor's value box.
   *
   * Only the free-text fields are answerable here (`title`, `content`,
   * `placeName`); categories and tags have their own managed lists, and date/time
   * have nothing worth suggesting. Anything else returns [].
   */
  listDistinctFieldValues(field: JournalPrefillField, limit: number): string[];
}
