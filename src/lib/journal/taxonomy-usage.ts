// Which managed categories/tags no entry actually uses — the "Clean up" button
// in the Meta Data section's Categories & Tags card, and the warning its bulk
// Delete shows before it detaches a name that is still in use.
//
// Both lists fill themselves: saving or importing an entry registers any
// category/tag name it mentions (`registerCategoriesIfMissing`), so a typo, a
// renamed tag, or a CSV import with a stray column leaves a managed row behind
// that no entry references. Nothing ever cleans those up, so a real journal
// accumulates them. These two reads are how the editor finds them.
//
// **Nothing here deletes.** `findUnusedTaxonomy` answers a question; the view
// ticks the rows it names and the reader presses Delete. That separation is the
// point — an automatic sweep would eventually drop a name the reader had just
// created and not yet used.

import type { JournalRepository } from "./ports";
import type { JournalTaxonomyCount } from "./types";

/** Which of the two managed lists a usage read is about. */
export type TaxonomyUsageKind = "category" | "tag";

/**
 * A managed name paired with how many entries carry it. `entryCount` is 0 for a
 * name that exists in the managed list and nowhere else.
 */
export interface TaxonomyUsage {
  name: string;
  entryCount: number;
}

/**
 * How a name is compared between the managed list and the entry rows.
 *
 * Trimmed and lowercased, matching `isLogEntry` rather than the exact-match SQL
 * paths. The asymmetry is what decides it: treating managed `"Work"` and
 * entry-side `"work"` as different names would report `"Work"` as unused and
 * offer it up for deletion, destroying a live category. Over-matching, by
 * contrast, only ever *under*-reports what can be cleaned up — a row stays in
 * the list one release longer, which nobody notices.
 *
 * Exported so the tests can state the rule directly rather than inferring it.
 */
export function normalizeTaxonomyName(name: string): string {
  return name.trim().toLowerCase();
}

/** The entry-side counts for one list, as stored on the entry rows. */
function entryCounts(repo: JournalRepository, kind: TaxonomyUsageKind): JournalTaxonomyCount[] {
  return kind === "category" ? repo.countEntriesByCategory() : repo.countEntriesByTag();
}

/** The managed list's names for one list. */
function managedNames(repo: JournalRepository, kind: TaxonomyUsageKind): string[] {
  return kind === "category"
    ? repo.listCategories().map((category) => category.name)
    : repo.listTags().map((tag) => tag.name);
}

/**
 * Every managed category/tag paired with how many entries use it, managed-list
 * order (which the repository returns sorted by name).
 *
 * Counts are summed across spellings that normalize alike, so a managed `"Work"`
 * reports the entries filed under `"work"` too — those are the same category
 * everywhere else in the app, and splitting them here would make the delete
 * warning understate what it is about to touch.
 *
 * Names appearing on entries but *not* in the managed list are left out: this
 * read exists to describe the rows the editor can see and act on. (That case is
 * nearly unreachable anyway, since saving an entry registers its names.)
 */
export function taxonomyUsageCounts(
  repo: JournalRepository,
  kind: TaxonomyUsageKind,
): TaxonomyUsage[] {
  const counts = new Map<string, number>();
  for (const row of entryCounts(repo, kind)) {
    const key = normalizeTaxonomyName(row.name);
    counts.set(key, (counts.get(key) ?? 0) + row.entryCount);
  }

  return managedNames(repo, kind).map((name) => ({
    name,
    entryCount: counts.get(normalizeTaxonomyName(name)) ?? 0,
  }));
}

/**
 * The managed names no entry uses — what "Clean up" offers to tick.
 *
 * Returns the names as they are stored in the managed list, not normalized, so
 * the caller can match them against the rows on screen and pass them straight
 * back to `deleteCategory`/`deleteTag`.
 */
export function findUnusedTaxonomy(
  repo: JournalRepository,
  kind: TaxonomyUsageKind,
): string[] {
  return taxonomyUsageCounts(repo, kind)
    .filter((usage) => usage.entryCount === 0)
    .map((usage) => usage.name);
}

/**
 * The subset of `names` that entries still carry, with their counts, busiest
 * first — the breakdown the bulk-delete confirm reads out.
 *
 * Scoped to the names passed in rather than returning everything, because the
 * caller is asking about a specific ticked selection. A name that isn't in the
 * managed list at all contributes nothing.
 */
export function taxonomyInUseAmong(
  repo: JournalRepository,
  kind: TaxonomyUsageKind,
  names: string[],
): TaxonomyUsage[] {
  const wanted = new Set(names.map(normalizeTaxonomyName));
  return taxonomyUsageCounts(repo, kind)
    .filter((usage) => usage.entryCount > 0 && wanted.has(normalizeTaxonomyName(usage.name)))
    .sort((a, b) => b.entryCount - a.entryCount || a.name.localeCompare(b.name));
}
