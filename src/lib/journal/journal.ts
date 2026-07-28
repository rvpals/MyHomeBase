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
import type { JournalCategory, JournalEntry, JournalTag } from "./types";

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

export function getEntry(repo: JournalRepository, id: number): JournalEntry | undefined {
  return repo.getEntryById(id);
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
