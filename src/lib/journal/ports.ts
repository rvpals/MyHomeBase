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
  RecycledJournalEntry,
  SavedJournalFilter,
} from "./types";
import type { DecodedImage } from "@/lib/shared/image-upload";

/**
 * The fields that make two journal entries the same entry on import.
 *
 * Content is deliberately excluded: a re-export whose body text was reflowed or
 * lightly edited is still the same entry, and including it would import a second
 * copy on every such change. The cost of that choice is that two entries sharing
 * a date, time and title are indistinguishable here — see
 * `countEntriesMatching` for how the importer keeps that safe.
 */
export interface JournalEntryMatchKey {
  date: string;
  time: string;
  title: string;
}

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
  /**
   * How many stored entries carry this exact date, time and title — the CSV
   * importer's duplicate check.
   *
   * A **count**, not a yes/no, for the same reason
   * `countMatchingTransactions` is one: `entry_time` and `title` both default
   * to `''`, so a bulk export can legitimately hold several untimed, untitled
   * rows on one day. Only by comparing how many the file holds against how many
   * are stored can the importer insert the shortfall and stay idempotent on
   * re-import — a boolean would collapse all of them into one entry.
   *
   * Date, time and title are compared as stored, except that title is trimmed
   * on both sides. Case is significant: a re-titled entry is a different entry.
   */
  countEntriesMatching(key: JournalEntryMatchKey): number;
  /**
   * The ids of every entry matching `key`, oldest first — the same predicate
   * `countEntriesMatching` counts.
   *
   * The overwrite import needs the id, not just the tally, to update a matched
   * entry in place. Ordered by id so that when a key has several copies, the
   * Nth CSV row overwrites the Nth stored entry deterministically rather than
   * whichever one SQLite happened to return first.
   */
  findEntryIdsMatching(key: JournalEntryMatchKey): number[];
  /** How many entries the journal holds in total, locked ones included. */
  countAllEntries(): number;
  /**
   * How many of those entries are locked. A separate count rather than a filter
   * on `listEntries` so the "clear everything" confirmation can say what it is
   * about to take without loading every entry and its child rows to find out.
   */
  countLockedEntries(): number;
  /**
   * Deletes every entry and its child rows in one transaction, and returns how
   * many entries went. The managed category and tag lists, their icons, and the
   * saved filters are left alone — this empties the journal, it does not reset
   * the module.
   *
   * Deliberately blind to `is_locked`: the lock guards a single entry against a
   * stray click on its own delete button, not against a deliberate "clear
   * everything" that the caller has already confirmed by count.
   */
  deleteAllEntries(): number;
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

  // Recycle bin (migration 0079). "Deleting" a duplicate moves it here, so a
  // mis-checked box is recoverable.

  /**
   * Moves `ids` out of jrn_entries and into the bin, with their categories,
   * tags and locations, in one transaction. Returns how many entries moved.
   *
   * Ids that don't exist are skipped rather than throwing: the list the user
   * ticked was rendered from a snapshot, and an entry deleted from another tab
   * in the meantime is the outcome they asked for, not an error.
   *
   * Blind to `is_locked` on purpose — the bin is what makes that safe. See the
   * migration log.
   */
  recycleEntries(ids: number[]): number;
  /** Everything in the bin, newest deleted first. */
  listRecycledEntries(): RecycledJournalEntry[];
  /**
   * Moves rows back into jrn_entries by their `recycledId`, with children, in
   * one transaction. Returns how many were restored.
   *
   * Each entry goes back at its original id when that id is still free,
   * otherwise at a fresh one. Unknown ids are skipped, same reasoning as
   * `recycleEntries`.
   */
  restoreRecycledEntries(recycledIds: number[]): number;
  /** Removes rows from the bin permanently, with children. Returns the count. */
  deleteRecycledEntriesForever(recycledIds: number[]): number;
  /** Empties the bin, children included. Returns how many entries went. */
  emptyRecycleBin(): number;
  /** How many entries the bin holds — for the confirm dialog's count. */
  countRecycledEntries(): number;
}
