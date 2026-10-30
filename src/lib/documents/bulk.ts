// Bulk operations over a selection of documents (migration 0163).
//
// Ticking twelve documents and filing them all under "Tax 2026" is the one thing a
// growing library makes constantly necessary and a per-row editor makes tedious.
//
// Nothing here is a new kind of write — these are the taxonomy changes `updateDocument`
// already makes, applied to many ids in one transaction. The transaction is the whole
// point: a half-applied bulk edit leaves the selection in two states with nothing to
// say which rows landed, which is worse than it not running at all.
//
// **Bulk recycle lives in `recycle.ts`, not here**, because it has to move files and
// belongs beside the rest of the bin's sequencing.

import { z } from "zod";
import type { BulkTaxonomyMode, DocumentsRepository } from "./ports";
import { taxonomyListSchema } from "./schema";

/**
 * Why there is no bulk edit of title or description.
 *
 * Both are per-document by nature: the only bulk operation available on them is
 * "set them all to the same string", which destroys twelve documents' identities in
 * one click and has no use that is not a mistake. Categories and tags are *sets*, so
 * adding to or removing from them composes across a selection sensibly.
 */
const idListSchema = z
  .array(z.number().int().positive())
  .min(1, "Select at least one document.")
  .transform((ids) => [...new Set(ids)]);

export const BULK_TAXONOMY_MODES = ["add", "remove", "replace"] as const;

export const bulkTaxonomySchema = z.object({
  ids: idListSchema,
  field: z.enum(["categories", "tags"]),
  mode: z.enum(BULK_TAXONOMY_MODES),
  names: taxonomyListSchema,
});

export type BulkTaxonomyInput = z.input<typeof bulkTaxonomySchema>;

export interface BulkTaxonomyResult {
  /** How many documents were actually changed. Ids that no longer exist are skipped. */
  changedCount: number;
  skippedCount: number;
}

/**
 * Adds, removes or replaces categories or tags across a selection.
 *
 * The three modes mirror the journal's bulk edit, and for the same reason: a document
 * holds *several* categories, so "add Tax to these twelve" and "replace their
 * categories with Tax" are different intentions, and a single-valued bulk edit would
 * silently discard filing the reader meant to keep.
 *
 * **`replace` with an empty list clears the field.** That is a real operation — "these
 * are untagged now" — but it is also the one call here that destroys information, so
 * the caller confirms it rather than treating it as an ordinary save. The use-case
 * still permits it: refusing would leave no way to clear a field in bulk at all.
 */
export function bulkSetTaxonomy(
  repo: DocumentsRepository,
  input: BulkTaxonomyInput,
): BulkTaxonomyResult {
  const parsed = bulkTaxonomySchema.parse(input);

  // `add` and `remove` of nothing are no-ops worth short-circuiting: they would
  // otherwise open a transaction and touch every selected row to write what was
  // already there, and report a change count that overstates what happened.
  // `replace` of nothing is NOT a no-op — it clears the field.
  if (parsed.names.length === 0 && parsed.mode !== "replace") {
    return { changedCount: 0, skippedCount: parsed.ids.length };
  }

  const changedCount = repo.bulkSetTaxonomy(
    parsed.ids,
    parsed.field,
    parsed.mode as BulkTaxonomyMode,
    parsed.names,
  );
  return { changedCount, skippedCount: parsed.ids.length - changedCount };
}

/**
 * A short human summary of what a bulk edit did, for the toast that follows it.
 *
 * In the library rather than the view because both the web app and the CLI report the
 * same outcome, and a count that reads "1 documents" is the kind of thing that only
 * gets fixed once if it is written once.
 */
export function describeBulkResult(result: BulkTaxonomyResult, noun = "document"): string {
  const { changedCount, skippedCount } = result;
  const plural = changedCount === 1 ? noun : `${noun}s`;
  const base = `${changedCount} ${plural} updated`;
  return skippedCount > 0 ? `${base}, ${skippedCount} skipped` : base;
}
