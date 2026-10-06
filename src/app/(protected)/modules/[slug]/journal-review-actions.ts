"use server";

// Server actions for the Review Data section.
//
// Thin adapters, as ARCHITECTURE.md requires: authorise, call a `lib` use-case,
// revalidate, return its result. The grouping and the merge draft are both pure
// functions in `src/lib/journal/same-date.ts`, so nothing here computes anything.
//
// Delete routes through the *existing* recycle bin (migration 0079) rather than
// destroying rows, so a mis-click on this screen is recoverable in exactly the
// place the reader already knows about: Data Management → CSV Import → Correct →
// Recycled Entries. That is why there is no restore or purge action here — the
// bin already has a screen, and giving it a second one would mean two views of
// one list that can disagree about what is in it.

import { revalidatePath } from "next/cache";
import {
  findSameDateGroups,
  getEntry,
  listEntries,
  lockEntries,
  mergeEntryDraft,
  recycleEntries,
} from "@/lib/journal";
import type { JournalEntry, MergedEntryDraft, SameDateGroup } from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "journal";

const JOURNAL_MODULE_PATH = "/modules/journal";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/**
 * Reads every entry and groups the dates carrying more than one.
 *
 * The whole journal, not a page of it — four entries sitting on one day in 2019
 * are exactly what this screen exists to surface, and any limit here would hide
 * them. What crosses to the client is bounded even though this read is not: the
 * excerpt is cut to 100 words inside `findSameDateGroups`, and only grouped
 * dates survive, so a journal of mostly one-entry days ships almost nothing.
 */
function readSameDateGroups(logOnly = false): SameDateGroup[] {
  return findSameDateGroups(listEntries(deps.journalRepo), { logOnly });
}

export interface SameDateDataResult extends ActionResult {
  groups?: SameDateGroup[];
}

/**
 * `logOnly` travels on every read and every mutation's refresh, rather than
 * being remembered server-side: the toggle is view state the browser owns, and
 * an action that re-read with the default would silently widen the list the
 * moment the reader deleted something while the toggle was on.
 */
export async function loadJournalSameDateDataAction(
  logOnly = false,
): Promise<SameDateDataResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    return { ok: true, groups: readSameDateGroups(logOnly) };
  } catch (error) {
    return toErrorResult(error, "Failed to load the same-date entries.");
  }
}

export interface RecycleSameDateResult extends SameDateDataResult {
  movedCount?: number;
  skippedCount?: number;
}

/**
 * Moves the ticked entries into the recycle bin.
 *
 * Returns the refreshed groups alongside the counts so the view re-renders from
 * server truth rather than patching its own state — deleting one of a date's two
 * entries drops that whole date out of the list (a single entry is no longer a
 * group), which a locally-applied guess would get wrong.
 */
export async function recycleJournalSameDateEntriesAction(
  ids: number[],
  logOnly = false,
): Promise<RecycleSameDateResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const { movedCount, skippedCount } = recycleEntries(deps.journalRepo, ids);
    revalidatePath(JOURNAL_MODULE_PATH);
    return { ok: true, movedCount, skippedCount, groups: readSameDateGroups(logOnly) };
  } catch (error) {
    return toErrorResult(error, "Failed to delete the selected entries.");
  }
}

export interface LockSameDateResult extends SameDateDataResult {
  lockedCount?: number;
  skippedCount?: number;
}

/**
 * Locks the ticked entries, which is also how they leave this screen.
 *
 * `findSameDateGroups` drops locked entries before it groups, so the refreshed
 * groups returned here no longer contain them — and any date left with fewer
 * than two unlocked entries is gone entirely. That is the point of the action:
 * a date the reader has settled stops being offered for review every time.
 *
 * Returns the refreshed groups for the same reason the delete action does: the
 * list after a lock is not something the view can guess by removing the ticked
 * rows, because locking two of a date's three entries removes all three.
 *
 * Unlike the delete beside it, nothing is destroyed — only `is_locked` is
 * written — so this needs no recycle-bin round trip and is undone by unlocking
 * the entry from the Entries list.
 */
export async function lockJournalSameDateEntriesAction(
  ids: number[],
  logOnly = false,
): Promise<LockSameDateResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const { lockedCount, skippedCount } = lockEntries(deps.journalRepo, ids);
    revalidatePath(JOURNAL_MODULE_PATH);
    return { ok: true, lockedCount, skippedCount, groups: readSameDateGroups(logOnly) };
  } catch (error) {
    return toErrorResult(error, "Failed to lock the selected entries.");
  }
}

export interface MergeDraftResult extends ActionResult {
  draft?: MergedEntryDraft;
  /** How many of the requested ids were found and actually merged. */
  mergedCount?: number;
  /**
   * The ids that actually went into the draft, in reading order.
   *
   * Returned as well as the count because the view offers to delete the
   * originals once the merged entry is saved, and that offer must name exactly
   * the entries whose content was captured. A requested id that no longer
   * existed is skipped here, so re-using the reader's original selection for
   * the delete could bin an entry this merge never read.
   */
  mergedIds?: number[];
}

/**
 * Builds the merged draft for the ticked entries.
 *
 * The grid's rows carry a 100-word excerpt, not the whole entry, so the full
 * entries are fetched here before merging — a draft built from excerpts would
 * silently truncate the reader's writing, which is the one failure this screen
 * must not have. Nothing is written by *this* action: the draft goes back to the
 * browser and the reader edits it in the ordinary entry form.
 *
 * Saving creates a new entry and still leaves every source entry in place — the
 * view then *offers* to bin the originals, which is a separate call to
 * `recycleJournalSameDateEntriesAction`. The order matters: the sources are only
 * ever removed after the merged entry is safely written, so a merge abandoned or
 * failed half way through cannot lose any writing.
 *
 * Ids that no longer exist are skipped rather than failing the whole merge;
 * `mergedCount` and `mergedIds` report what was actually used, so the view can
 * say so and can scope that delete offer correctly.
 */
export async function buildJournalMergeDraftAction(ids: number[]): Promise<MergeDraftResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const entries = ids
      .map((id) => getEntry(deps.journalRepo, id))
      .filter((entry): entry is JournalEntry => entry !== undefined);
    if (entries.length === 0) {
      return { ok: false, error: "None of the selected entries could be read." };
    }
    return {
      ok: true,
      draft: mergeEntryDraft(entries),
      mergedCount: entries.length,
      mergedIds: entries.map((entry) => entry.id),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to build the merged entry.");
  }
}

export interface SameDateEntryResult extends ActionResult {
  entry?: JournalEntry;
}

/**
 * One full entry, for the viewer modal.
 *
 * Same reasoning as the Correct tab's `getJournalEntryAction`: the list carries
 * an excerpt, so opening a row fetches the entry it is about to show rather than
 * every row shipping its whole content up front. A separate action from that one
 * because each must authorise on its own first line — importing another route's
 * action to save eight lines is the cross-route import the repo already had to
 * fix once.
 */
export async function getJournalSameDateEntryAction(id: number): Promise<SameDateEntryResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const entry = getEntry(deps.journalRepo, id);
    if (!entry) return { ok: false, error: `No journal entry with id ${id}.` };
    return { ok: true, entry };
  } catch (error) {
    return toErrorResult(error, "Failed to load that entry.");
  }
}
