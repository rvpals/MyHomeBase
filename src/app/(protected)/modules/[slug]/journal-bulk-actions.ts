"use server";

// The bulk actions behind the Entries screen's tick-boxes, shared by **both**
// tabs — Main and Log.
//
// A file of their own rather than an addition to journal-log-actions.ts: these
// are used from two views, and parking them in the Log tab's action file would
// make the Main tab import "log actions" to edit a written entry. The Log tab's
// own `deleteLogEntriesAction` stays where it is — it returns the Log list
// specifically, which these don't.
//
// Each action re-reads the rows after writing and hands the caller a fresh list,
// so a view re-renders from server truth rather than patching its own copy. The
// two lists a caller might want differ (Main is filtered, Log is not), so the
// caller says which one it wants back via `scope`.

import { revalidatePath } from "next/cache";
import {
  bulkEditEntries,
  describeBulkEditResult,
  findEntries,
  listLogEntries,
  recycleEntries,
  withLogCondition,
  type BulkEntryEditInput,
  type JournalEntry,
  type JournalFilter,
} from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "journal";

const JOURNAL_MODULE_PATH = "/modules/journal";

/** Matches ENTRIES_RESULT_LIMIT in journal-actions.ts and journal-entries-panel.tsx. */
const ENTRIES_LIMIT = 500;

/**
 * Which list the caller wants handed back after the write.
 *
 * The Main tab re-queries its current filter (so a row edited out of the filter
 * disappears, which is the honest result); the Log tab re-reads the Log list.
 */
export type BulkRefreshScope =
  | { tab: "main"; filter: JournalFilter }
  | { tab: "log" };

export interface BulkActionResult {
  ok: boolean;
  error?: string;
  /** The refreshed rows for whichever tab asked. */
  entries?: JournalEntry[];
  /** One line describing what happened, built in `lib` so the CLI prints the same. */
  message?: string;
}

function toErrorResult(error: unknown, fallback: string): BulkActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

function refresh(scope: BulkRefreshScope): JournalEntry[] {
  if (scope.tab === "log") return listLogEntries(deps.journalRepo, ENTRIES_LIMIT);
  // `"all"` — the Main tab shows every entry, logged activities included. Same
  // scope findJournalEntriesAction applies, so the refreshed list matches what a
  // filter change would have produced.
  return findEntries(deps.journalRepo, withLogCondition(scope.filter, "all"), ENTRIES_LIMIT);
}

/**
 * Moves the ticked entries to the recycle bin.
 *
 * The bin, not a hard delete — a mis-ticked row in a list of hundreds has to be
 * recoverable. They are restorable from Data Management → CSV Import → Correct.
 *
 * **Locked entries move too**, deliberately. The bin stores `isLocked` with the
 * row, so the lock survives the trip and a restore brings the entry back locked;
 * nothing is bypassed. This is the opposite of bulk *edit* below, which skips
 * locked rows because an edit genuinely would bypass the lock. See the note at
 * the top of src/lib/journal/recycle.ts.
 */
export async function deleteJournalEntriesAction(
  ids: number[],
  scope: BulkRefreshScope,
): Promise<BulkActionResult & { movedCount?: number; skippedCount?: number }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const { movedCount, skippedCount } = recycleEntries(deps.journalRepo, ids);
    revalidatePath(JOURNAL_MODULE_PATH);
    return {
      ok: true,
      movedCount,
      skippedCount,
      entries: refresh(scope),
      message:
        `Moved ${movedCount} ${movedCount === 1 ? "entry" : "entries"} to the recycle bin.` +
        (skippedCount > 0 ? ` ${skippedCount} were already gone.` : ""),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to delete the selected entries.");
  }
}

/**
 * Applies one change to every ticked entry.
 *
 * Locked entries are skipped and counted rather than refusing the whole edit —
 * one locked row must not block a fifty-row change. The count is in `message`.
 */
export async function bulkEditJournalEntriesAction(
  ids: number[],
  changes: BulkEntryEditInput,
  scope: BulkRefreshScope,
): Promise<BulkActionResult & { updatedCount?: number; skippedLockedCount?: number }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const result = bulkEditEntries(deps.journalRepo, ids, changes);
    revalidatePath(JOURNAL_MODULE_PATH);
    return {
      ok: true,
      updatedCount: result.updatedCount,
      skippedLockedCount: result.skippedLockedCount,
      entries: refresh(scope),
      message: describeBulkEditResult(result),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to edit the selected entries.");
  }
}
