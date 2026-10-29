// The clips recycle bin (migration 0161) and the delete that fills it.
//
// The Home screen's Delete button moves a clip here; Clips → Recycled Clips
// restores them, purges them, or empties the bin.
//
// These use-cases are thin over the repository on purpose — the interesting work
// (copying six tables in one transaction, choosing the id a restore lands on) is
// SQL, and belongs in the repository next to the statements it runs. What lives
// here is the input validation and the contract each operation reports back, so
// the web action and the CLI behave identically. The journal's `recycle.ts` is
// deliberately the same file with different nouns.

import { z } from "zod";
import type { ClipsRepository } from "./ports";
import type { RecycledClip } from "./types";

/**
 * A list of ids from a boundary (a form post, a CLI argument).
 *
 * Non-empty because every caller is acting on a selection, and an empty one is a
 * UI bug worth surfacing rather than a no-op worth hiding. The de-dupe is
 * deliberate: a double-submitted button must not make the returned count
 * disagree with what the reader was shown.
 */
const idListSchema = z
  .array(z.number().int().positive())
  .min(1, "Select at least one clip.")
  .transform((ids) => [...new Set(ids)]);

export interface ClipRecycleResult {
  /** How many clips actually moved. May be less than requested — see below. */
  movedCount: number;
  /** How many requested ids no longer existed and were skipped. */
  skippedCount: number;
}

/**
 * Moves the given clips into the bin.
 *
 * This is what the Delete button calls. A clip is the only copy of whatever was
 * pasted into it, which is precisely why deleting it stopped being immediate —
 * `deleteClip` still exists, but only the bin's purge and the CLI's
 * `--forever` reach it.
 *
 * A **sealed** clip moves too, sealed, and comes back sealed. The bin is not a
 * way around the password: nothing here reads a clip's plaintext.
 */
export function recycleClips(repo: ClipsRepository, ids: number[]): ClipRecycleResult {
  const validated = idListSchema.parse(ids);
  const movedCount = repo.recycleClips(validated);
  return { movedCount, skippedCount: validated.length - movedCount };
}

/** Everything in the bin, newest deleted first. */
export function listRecycledClips(repo: ClipsRepository, excerptChars: number): RecycledClip[] {
  // Clamped the same way the live list's is, through the filter schema's default,
  // so a caller passing nonsense gets a short excerpt rather than a read of the
  // whole binned body.
  return repo.listRecycledClips(Math.max(1, Math.floor(excerptChars)));
}

export interface ClipRestoreResult {
  restoredCount: number;
  skippedCount: number;
}

/**
 * Puts binned clips back, keyed by `recycledId`.
 *
 * A restored clip keeps its original id when that id is still free — which is
 * what keeps an existing link, and the journal badge it draws, working across a
 * delete and a restore. If it isn't free, the clip comes back under a new id
 * rather than overwriting whatever is there now, and its links are left pointing
 * at nothing; this module already renders that as "the linked record is gone".
 *
 * Nothing is merged. A restore adds the clip back; it never reconciles it with
 * something written since.
 */
export function restoreRecycledClips(
  repo: ClipsRepository,
  recycledIds: number[],
): ClipRestoreResult {
  const validated = idListSchema.parse(recycledIds);
  const restoredCount = repo.restoreRecycledClips(validated);
  return { restoredCount, skippedCount: validated.length - restoredCount };
}

export interface ClipPurgeResult {
  deletedCount: number;
  skippedCount: number;
}

/** Removes clips from the bin for good. There is no undo past this point. */
export function deleteRecycledClipsForever(
  repo: ClipsRepository,
  recycledIds: number[],
): ClipPurgeResult {
  const validated = idListSchema.parse(recycledIds);
  const deletedCount = repo.deleteRecycledClipsForever(validated);
  return { deletedCount, skippedCount: validated.length - deletedCount };
}

/**
 * Empties the bin.
 *
 * No id list, so no `idListSchema` guard and no minimum: emptying an already
 * empty bin is a harmless no-op that reports 0, unlike a selection-based call
 * where an empty list means the UI lost the reader's ticks.
 */
export function emptyClipsRecycleBin(repo: ClipsRepository): { deletedCount: number } {
  return { deletedCount: repo.emptyClipsRecycleBin() };
}

/** How many clips the bin holds — the number the confirmations quote. */
export function countRecycledClips(repo: ClipsRepository): number {
  return repo.countRecycledClips();
}
