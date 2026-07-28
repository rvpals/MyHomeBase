import type { EntryWriteData, UpsertCategoryInput, UpsertTagInput } from "./schema";
import type { JournalCategory, JournalEntry, JournalTag } from "./types";

// The interface a journal use-case depends on. The real SQLite implementation
// is wired in at wiring.ts; tests wire in an in-memory fake. Use-cases never see
// the concrete class.
export interface JournalRepository {
  // Entries — each create/update/delete writes the entry and its child rows
  // (categories, tags, locations) in a single transaction.
  listEntries(): JournalEntry[];
  getEntryById(id: number): JournalEntry | undefined;
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
}
