"use server";

// The bulk actions behind the Entries screen's tick-boxes, shared by **every**
// tab — All Entries, Unlocked, Substantial, Log and Search Results.
//
// A file of their own rather than an addition to journal-actions.ts: these are
// the writes, and keeping them apart is what makes the authorisation on each
// one easy to audit.
//
// There used to be a second set in journal-log-actions.ts, because the Log tab
// was its own section with its own grid and its own delete. That tab is now the
// same component as the rest (see journal-entries-view.tsx), so the second set
// is gone and these are the only bulk writes on the screen — which is what
// makes Lock, Unlock and Encrypt available on every tab rather than three of
// them.
//
// Each action re-reads the rows after writing and hands the caller a fresh list,
// so a view re-renders from server truth rather than patching its own copy. The
// lists a caller might want differ in which conditions apply, so the caller says
// which tab is asking via `scope`.

import { revalidatePath } from "next/cache";
import {
  bulkEditEntries,
  bulkEncryptEntries,
  bulkSetEntriesLocked,
  describeBulkEditResult,
  describeBulkEncryptResult,
  describeBulkLockResult,
  findDuplicateGroups,
  findEntries,
  getEntry,
  listEntries,
  listEntriesOnMonthDayKey,
  mergeEntryDraft,
  recycleEntries,
  searchEntries,
  splitMergeSources,
  toDuplicateRows,
  withLockedCondition,
  withLogCondition,
  type BulkEntryEditInput,
  type JournalEntry,
  type JournalFilter,
  type MergedEntryDraft,
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
 * Every tab re-queries its own filter with its own conditions re-applied, so a
 * row the write pushed out of the tab leaves the list — which is the honest
 * result. The All Entries tab re-queries the filter alone; Unlocked adds the
 * lock condition back, so a row just locked from that tab disappears; Log adds
 * the Log condition back, so a row bulk-edited out of the Log category
 * disappears from it.
 *
 * The Substantial Entries tab works the same way with the **body-length
 * condition re-applied**: a bulk edit that trims a body below the word count
 * drops the row from the list it hands back, which is the same honesty as a row
 * edited out of a filter.
 *
 * Each tab is its own arm rather than a set of flags on `"main"`: the arms are
 * what `refresh()` below reads to decide which conditions to re-apply, and a
 * tab that forgets to name itself would be handed back another tab's rows.
 *
 * `"duplicates"` is Data Management → Duplicate entries, which has no filter at
 * all: it re-asks the whole-journal question "which entries share a date and a
 * title". It is the one arm that hands back a **subtype** of `JournalEntry` —
 * `DuplicateRow`, which carries its group's identity — so a write that breaks a
 * duplicate pair really does drop both rows from the list. See the note on
 * `adopt` in journal-entries-grid.tsx, which is where that is relied on.
 *
 * `"onThisDay"` hands back a subtype too — `OnThisDayRow`, carrying the
 * 100-word `excerpt` its Content column reads in place of the blanked body. It
 * is the Calendar cell's **Today in history** dialog, which has no
 * filter either: it re-asks "every entry on this month and day, in any year".
 * Keyed by the month-day rather than by the date that was clicked, because the
 * dialog's question has no year in it — handing back one year's entries after a
 * write would empty the list of everything the dialog exists to show.
 */
export type BulkRefreshScope =
  | { tab: "main"; filter: JournalFilter }
  | { tab: "unlocked"; filter: JournalFilter }
  | { tab: "substantial"; filter: JournalFilter }
  | { tab: "log"; filter: JournalFilter }
  | { tab: "search"; term: string }
  | { tab: "duplicates" }
  | { tab: "onThisDay"; monthDay: string };

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
  if (scope.tab === "search") return searchEntries(deps.journalRepo, scope.term, ENTRIES_LIMIT);
  // The Duplicates card, re-grouped from scratch. Deliberately not capped at
  // ENTRIES_LIMIT and deliberately not narrowed: two entries duplicating each
  // other in 2019 are exactly what that screen exists to find, and a page of the
  // newest N would hide them. What crosses the wire is still bounded — the rows
  // carry whole entries with `content` blanked. See src/lib/journal/duplicates.ts.
  if (scope.tab === "duplicates") {
    return toDuplicateRows(findDuplicateGroups(listEntries(deps.journalRepo)));
  }
  // The Calendar cell's Today in history dialog, re-asked from scratch. Like the
  // Duplicates card above this is uncapped and unnarrowed: the whole point is
  // the 2011 entry, which a page of the newest N would hide. Bounded in a
  // different way — one month-day is 1/366th of the journal, and the rows cross
  // the wire with `content` blanked (src/lib/journal/on-this-day.ts).
  if (scope.tab === "onThisDay") {
    return listEntriesOnMonthDayKey(deps.journalRepo, scope.monthDay);
  }
  // One read for the other four tabs, with each tab's own condition re-applied
  // rather than assumed unchanged. Lock on the Unlocked tab, an edit that
  // shortens a body on the Substantial tab, and an edit that drops the Log
  // category on the Log tab each write rows that no longer belong in the list
  // being handed back.
  //
  // The same three scopes findJournalEntriesAction applies, in the same order,
  // so a refreshed list matches what a filter change would have produced.
  return findEntries(
    deps.journalRepo,
    withLockedCondition(
      withLogCondition(scope.filter, scope.tab === "log" ? "only" : "all"),
      scope.tab === "unlocked" ? "unlocked" : "all",
    ),
    ENTRIES_LIMIT,
    scope.tab === "substantial" ? "substantial" : "all",
  );
}

/**
 * Moves the ticked entries to the recycle bin.
 *
 * The bin, not a hard delete — a mis-ticked row in a list of hundreds has to be
 * recoverable. They are restorable from Data Management → Recycle Bin.
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
  ignoreLocked = false,
): Promise<BulkActionResult & { updatedCount?: number; skippedLockedCount?: number }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  const log = deps.systemLogger;
  try {
    log.debug("bulk-edit", () => {
      const parts = [`ids=[${ids.join(",")}]`];
      if (changes.categories) parts.push(`categories(${changes.categories.mode}): [${(changes.categories.names ?? []).join(", ")}]`);
      if (changes.tags) parts.push(`tags(${changes.tags.mode}): [${(changes.tags.names ?? []).join(", ")}]`);
      if (changes.placeName !== undefined) parts.push(`placeName: "${changes.placeName}"`);
      if (changes.locations) parts.push(`locations(${changes.locations.mode}): ${(changes.locations.locations ?? []).map(l => l.locationName || `${l.latitude},${l.longitude}`).join(", ")}`);
      if (ignoreLocked) parts.push("ignoreLocked");
      return `bulkEditEntries ${parts.join(" | ")}`;
    });
    const result = bulkEditEntries(deps.journalRepo, ids, changes, { ignoreLocked });
    for (const id of result.relockedIds ?? []) {
      log.debug(
        "bulk-edit",
        `entry #${id} was locked, before overwriting, it's unlocked, updated then locked again.`,
      );
    }
    log.debug("bulk-edit", () => `bulkEditEntries result: updated=${result.updatedCount} skippedLocked=${result.skippedLockedCount} missing=${result.missingCount}`);
    revalidatePath(JOURNAL_MODULE_PATH);
    const entries = refresh(scope);
    log.debug("bulk-edit", () => `refresh returned ${entries.length} entries; sample cats=${JSON.stringify(entries.slice(0, 3).map(e => ({ id: e.id, cats: e.categories })))}`);
    return {
      ok: true,
      updatedCount: result.updatedCount,
      skippedLockedCount: result.skippedLockedCount,
      entries,
      message: describeBulkEditResult(result),
    };
  } catch (error) {
    log.debug("bulk-edit", () => `bulkEditEntries error: ${error instanceof Error ? error.message : String(error)}`);
    return toErrorResult(error, "Failed to edit the selected entries.");
  }
}

/**
 * Locks or unlocks every ticked entry.
 *
 * The one bulk action that deliberately **writes locked rows**: changing the
 * lock is the operation, so refusing a locked entry would leave no way to
 * unlock one. Bulk *edit* above is the opposite and skips them, because there a
 * write would be a genuine bypass. See the note at the top of
 * src/lib/journal/bulk-lock.ts.
 *
 * `isLocked` is the target state, not a toggle — the screen offers Lock and
 * Unlock as two buttons so a mixed selection has a defined result.
 */
export async function bulkLockJournalEntriesAction(
  ids: number[],
  isLocked: boolean,
  scope: BulkRefreshScope,
): Promise<BulkActionResult & { changedCount?: number; unchangedCount?: number }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const result = bulkSetEntriesLocked(deps.journalRepo, ids, isLocked);
    revalidatePath(JOURNAL_MODULE_PATH);
    return {
      ok: true,
      changedCount: result.changedCount,
      unchangedCount: result.unchangedCount,
      entries: refresh(scope),
      message: describeBulkLockResult(result),
    };
  } catch (error) {
    return toErrorResult(
      error,
      `Failed to ${isLocked ? "lock" : "unlock"} the selected entries.`,
    );
  }
}

/**
 * Seals the title and content of every eligible ticked entry under one password.
 *
 * **The password crosses the wire and is never stored** — not here, not in the
 * repository, not in the database. It is used to derive a key, and then it is
 * gone with the request. That also means there is no recovery path: this action
 * cannot undo itself, and nothing on the server can open the result. The dialog
 * says so before the reader confirms.
 *
 * Locked and already-encrypted entries are skipped and counted, not refused —
 * one ineligible row must not block a forty-row batch. The counts are in
 * `message`.
 */
export async function bulkEncryptJournalEntriesAction(
  ids: number[],
  password: string,
  hint: string,
  scope: BulkRefreshScope,
): Promise<BulkActionResult & { encryptedCount?: number }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const result = bulkEncryptEntries(deps.journalRepo, ids, password, hint);
    revalidatePath(JOURNAL_MODULE_PATH);
    return {
      ok: true,
      encryptedCount: result.encryptedCount,
      entries: refresh(scope),
      message: describeBulkEncryptResult(result),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to encrypt the selected entries.");
  }
}

/**
 * Re-reads the grid's rows for its current scope, with no write.
 *
 * For the screens that change a row outside the bulk actions above — a merge
 * saves a new entry from its own form — so the list can show it without a page
 * reload.
 */
export async function refreshJournalEntriesAction(
  scope: BulkRefreshScope,
): Promise<BulkActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    return { ok: true, entries: refresh(scope) };
  } catch (error) {
    return toErrorResult(error, "Failed to re-read the entries.");
  }
}

export interface MergeDraftResult {
  ok: boolean;
  error?: string;
  draft?: MergedEntryDraft;
  /** How many of the requested ids were found and actually merged. */
  mergedCount?: number;
  /**
   * The ids that actually went into the draft, in the order they were asked for.
   *
   * Returned as well as the count because the screen offers to delete the
   * originals once the merged entry is saved, and that offer must name exactly
   * the entries whose content was captured. A requested id that no longer
   * existed is skipped here, so re-using the reader's original selection for
   * the delete could bin an entry this merge never read.
   */
  mergedIds?: number[];
  /**
   * Locked entries left out of the merge. Always 0 on the Review Data screen,
   * which never lists a locked entry; the Entries grid can show one.
   */
  skippedLockedCount?: number;
}

/**
 * Builds the merged draft for the ticked entries — shared by the Review Data
 * screen and the Entries grid.
 *
 * The grid's rows carry a 100-word excerpt, not the whole entry, so the full
 * entries are fetched here before merging — a draft built from excerpts would
 * silently truncate the reader's writing, which is the one failure these
 * screens must not have. Nothing is written by this action: the draft goes back
 * to the browser and the reader edits it in the ordinary entry form.
 *
 * Saving creates a new entry and still leaves every source entry in place; the
 * screen then *offers* to bin the originals. The sources are only removed after
 * the merged entry is safely written, so a merge abandoned half way cannot lose
 * any writing.
 *
 * Ids that no longer exist are skipped, and locked entries are skipped and
 * counted (`splitMergeSources`). An encrypted source makes `mergeEntryDraft`
 * throw, which comes back as the error.
 */
export async function buildJournalMergeDraftAction(ids: number[]): Promise<MergeDraftResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const found = ids
      .map((id) => getEntry(deps.journalRepo, id))
      .filter((entry): entry is JournalEntry => entry !== undefined);
    const { sources, lockedCount } = splitMergeSources(found);
    if (sources.length === 0) {
      return {
        ok: false,
        error:
          lockedCount > 0
            ? "Every selected entry is locked, so there is nothing to merge."
            : "None of the selected entries could be read.",
      };
    }
    return {
      ok: true,
      draft: mergeEntryDraft(sources),
      mergedCount: sources.length,
      mergedIds: sources.map((entry) => entry.id),
      skippedLockedCount: lockedCount,
    };
  } catch (error) {
    return toErrorResult(error, "Failed to build the merged entry.");
  }
}
