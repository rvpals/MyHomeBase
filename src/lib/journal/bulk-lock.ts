// Bulk lock/unlock for a selection of journal entries — the Entries screen's
// "Lock" and "Unlock" buttons, beside Bulk edit and Delete.
//
// The third member of the selection-action family, after recycle.ts (the
// selection delete) and bulk-edit.ts (the selection change). It differs from
// both on locked entries, and the reason is the whole point of the file:
//
//   - **Bulk edit skips locked entries**, because writing them would be exactly
//     the bypass the lock exists to prevent.
//   - **This one writes them**, because changing the lock *is* the operation.
//     `setLocked` in journal.ts is unguarded for the same reason — it is the
//     only way to unlock an entry, so a lock check there would be a trap with
//     no key.
//
// So there is no `skippedLockedCount` here, and that absence is deliberate
// rather than an oversight. What a row can be is already in the requested
// state, which is reported separately from a write: locking forty entries of
// which thirty were already locked should not claim forty locks.
//
// Validation and the reported contract live here; the transaction and the SQL
// live in the repository, next to the statements they run. Same division as
// recycle.ts and bulk-edit.ts.

import { z } from "zod";
import type { JournalRepository } from "./ports";

/**
 * A list of ids from a boundary (a form post, a CLI argument).
 *
 * Non-empty and de-duped for the same reasons as `recycle.ts`'s copy: an empty
 * selection is a UI bug worth surfacing, and a double-submitted checkbox must
 * not make the reported count disagree with what the user was shown.
 */
const idListSchema = z
  .array(z.number().int().positive())
  .min(1, "Select at least one entry.")
  .transform((ids) => [...new Set(ids)]);

export interface BulkLockResult {
  /** Which way the lock was moved — carried through so the message can say so. */
  isLocked: boolean;
  /** How many entries actually changed state. */
  changedCount: number;
  /** How many were already locked (or already unlocked) and so were left alone. */
  unchangedCount: number;
  /** How many requested ids no longer existed. */
  missingCount: number;
}

/**
 * Locks or unlocks every selected entry.
 *
 * `isLocked` is set outright rather than toggled per row. A toggle over a mixed
 * selection has no honest result — half would lock and half unlock, and the
 * button could not say in advance which a given row would get — so the screen
 * offers Lock and Unlock as two explicit actions and this takes the target
 * state.
 *
 * Nothing else about an entry is touched: not its content, not its categories,
 * not its `updated_at`. A lock is a change of *custody*, not of the entry, and
 * bumping the timestamp would make every locked row look freshly edited in a
 * list sorted by modification.
 */
export function bulkSetEntriesLocked(
  repo: JournalRepository,
  ids: number[],
  isLocked: boolean,
): BulkLockResult {
  const validated = idListSchema.parse(ids);
  const outcome = repo.bulkSetEntriesLocked(validated, isLocked);
  return {
    isLocked,
    changedCount: outcome.changedIds.length,
    unchangedCount: outcome.unchangedIds.length,
    missingCount: outcome.missingIds.length,
  };
}

/**
 * One line summarising what a bulk lock did, for the web notice and the CLI's
 * stdout to print identically.
 *
 * In `lib` rather than in the view because both adapters show it and the counts
 * it has to get right — notably "nothing changed" — are the kind of thing two
 * copies drift on. Mirrors `describeBulkEditResult`.
 */
export function describeBulkLockResult(result: BulkLockResult): string {
  const verb = result.isLocked ? "Locked" : "Unlocked";
  const already = result.isLocked ? "already locked" : "already unlocked";
  const parts: string[] = [];
  parts.push(
    result.changedCount === 1
      ? `${verb} 1 entry.`
      : `${verb} ${result.changedCount} entries.`,
  );
  if (result.unchangedCount > 0) {
    parts.push(
      result.unchangedCount === 1
        ? `1 was ${already}.`
        : `${result.unchangedCount} were ${already}.`,
    );
  }
  if (result.missingCount > 0) {
    parts.push(
      result.missingCount === 1 ? "1 no longer exists." : `${result.missingCount} no longer exist.`,
    );
  }
  return parts.join(" ");
}
