// The journal recycle bin (migration 0079) and the bulk delete that fills it.
//
// The Correct tab's Duplicates card deletes by moving entries here; the Recycled
// Entries card restores them, purges them, or empties the bin.
//
// These use-cases are thin over the repository on purpose — the interesting work
// (copying four tables in one transaction, choosing the id a restore lands on)
// is SQL, and belongs in the repository next to the statements it runs. What
// lives here is the input validation and the contract each operation reports
// back, so the web action and the CLI behave identically.

import { z } from "zod";
import type { JournalRepository } from "./ports";
import type { RecycledJournalEntry } from "./types";

/**
 * A list of ids from a boundary (a form post, a CLI argument).
 *
 * Non-empty because every caller is acting on a user's tick-boxes, and an empty
 * selection is a UI bug worth surfacing rather than a no-op worth hiding. The
 * de-dupe is deliberate: a double-submitted checkbox must not make the returned
 * count disagree with what the user was shown.
 */
const idListSchema = z
  .array(z.number().int().positive())
  .min(1, "Select at least one entry.")
  .transform((ids) => [...new Set(ids)]);

export interface RecycleResult {
  /** How many entries actually moved. May be less than requested — see below. */
  movedCount: number;
  /** How many requested ids no longer existed and were skipped. */
  skippedCount: number;
}

/**
 * Moves the given entries into the recycle bin.
 *
 * The ids are taken as given: this does NOT re-verify that they are duplicates.
 * The Duplicates card found candidates, a human read them and ticked the ones to
 * go, and second-guessing that here would mean refusing a delete the user
 * deliberately asked for (they may well have edited one copy's title first).
 *
 * Locked entries move too. `deleteEntry` refuses them because a single stray
 * click is unrecoverable; here the entry lands in the bin with `isLocked`
 * intact, so the lock is preserved rather than bypassed.
 */
export function recycleEntries(repo: JournalRepository, ids: number[]): RecycleResult {
  const validated = idListSchema.parse(ids);
  const movedCount = repo.recycleEntries(validated);
  return { movedCount, skippedCount: validated.length - movedCount };
}

/** Everything in the bin, newest deleted first. */
export function listRecycledEntries(repo: JournalRepository): RecycledJournalEntry[] {
  return repo.listRecycledEntries();
}

export interface RestoreResult {
  restoredCount: number;
  skippedCount: number;
}

/**
 * Puts recycled entries back into the journal, keyed by `recycledId`.
 *
 * A restored entry keeps its original id when that id is still free. If it
 * isn't — a later entry took it, or the CSV importer created one — the entry
 * comes back under a new id rather than overwriting whatever is there now.
 * Nothing is merged: if an entry matching the same date and title has appeared
 * since, the restore adds a second one and the user sees both, which is the
 * honest outcome and lands them back on the Duplicates card if they want to
 * resolve it.
 */
export function restoreRecycledEntries(repo: JournalRepository, recycledIds: number[]): RestoreResult {
  const validated = idListSchema.parse(recycledIds);
  const restoredCount = repo.restoreRecycledEntries(validated);
  return { restoredCount, skippedCount: validated.length - restoredCount };
}

export interface PurgeResult {
  deletedCount: number;
  skippedCount: number;
}

/** Removes entries from the bin for good. There is no undo past this point. */
export function deleteRecycledEntriesForever(
  repo: JournalRepository,
  recycledIds: number[],
): PurgeResult {
  const validated = idListSchema.parse(recycledIds);
  const deletedCount = repo.deleteRecycledEntriesForever(validated);
  return { deletedCount, skippedCount: validated.length - deletedCount };
}

/**
 * Empties the bin.
 *
 * No id list, so no `idListSchema` guard and no minimum: emptying an already
 * empty bin is a harmless no-op that reports 0, unlike a selection-based call
 * where an empty list means the UI lost the user's ticks.
 */
export function emptyRecycleBin(repo: JournalRepository): { deletedCount: number } {
  return { deletedCount: repo.emptyRecycleBin() };
}

/** How many entries the bin holds — the number the confirmations quote. */
export function countRecycledEntries(repo: JournalRepository): number {
  return repo.countRecycledEntries();
}
