"use server";

import { revalidatePath } from "next/cache";
import {
  countRecycledEntries,
  deleteRecycledEntriesForever,
  emptyRecycleBin,
  findDuplicateGroups,
  getEntry,
  listEntries,
  listRecycledEntries,
  restoreRecycledEntries,
} from "@/lib/journal";
import type { DuplicateGroup, JournalEntry, RecycledJournalEntry } from "@/lib/journal";
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
 * Both cards' contents in one round trip.
 *
 * A single result rather than one per card because the bin's own writes still
 * change both lists at once — restoring an entry puts it back where it can
 * duplicate another — so the two must never be refreshed independently or they
 * will disagree about where an entry is.
 */
export interface CorrectDataResult extends ActionResult {
  duplicateGroups?: DuplicateGroup[];
  recycledEntries?: RecycledJournalEntry[];
}

export async function loadJournalCorrectDataAction(): Promise<CorrectDataResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    return { ok: true, ...readCorrectData() };
  } catch (error) {
    return toErrorResult(error, "Failed to load that screen.");
  }
}

// The Duplicates card's Delete used to live here, as `recycleJournalEntriesAction`.
// That card now runs the **same seven bulk actions as the List of Entries**
// (journal-entries-grid.tsx), so its Delete is `deleteJournalEntriesAction` in
// journal-bulk-actions.ts, re-reading with `{ tab: "duplicates" }`. The one
// behaviour that changed: a delete there refreshes the duplicate rows and not
// the bin list, which is invisible while the two cards are separate sections.

export interface RestoreEntriesResult extends CorrectDataResult {
  restoredCount?: number;
  skippedCount?: number;
}

export async function restoreJournalEntriesAction(
  recycledIds: number[],
): Promise<RestoreEntriesResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const { restoredCount, skippedCount } = restoreRecycledEntries(deps.journalRepo, recycledIds);
    revalidatePath(JOURNAL_MODULE_PATH);
    return { ok: true, restoredCount, skippedCount, ...readCorrectData() };
  } catch (error) {
    return toErrorResult(error, "Failed to restore the selected entries.");
  }
}

export interface PurgeEntriesResult extends CorrectDataResult {
  deletedCount?: number;
}

export async function deleteRecycledForeverAction(
  recycledIds: number[],
): Promise<PurgeEntriesResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const { deletedCount } = deleteRecycledEntriesForever(deps.journalRepo, recycledIds);
    revalidatePath(JOURNAL_MODULE_PATH);
    return { ok: true, deletedCount, ...readCorrectData() };
  } catch (error) {
    return toErrorResult(error, "Failed to delete the selected entries forever.");
  }
}

export async function emptyRecycleBinAction(): Promise<PurgeEntriesResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const { deletedCount } = emptyRecycleBin(deps.journalRepo);
    revalidatePath(JOURNAL_MODULE_PATH);
    return { ok: true, deletedCount, ...readCorrectData() };
  } catch (error) {
    return toErrorResult(error, "Failed to empty the recycle bin.");
  }
}

export interface RecycleBinCountResult extends ActionResult {
  totalCount?: number;
}

/** Read on click, so the "empty the bin" warning quotes the live number. */
export async function countRecycledEntriesAction(): Promise<RecycleBinCountResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    return { ok: true, totalCount: countRecycledEntries(deps.journalRepo) };
  } catch (error) {
    return toErrorResult(error, "Failed to count the recycle bin.");
  }
}

/**
 * Reads both lists.
 *
 * `listEntries` with no limit is deliberate: duplicate detection is a whole-
 * journal question, and a page of the newest N entries would miss the pair
 * sitting in 2019. Each row's body is blanked in the library before this
 * crosses to the client, so what travels is bounded even though what is read
 * is not.
 */
function readCorrectData(): {
  duplicateGroups: DuplicateGroup[];
  recycledEntries: RecycledJournalEntry[];
} {
  return {
    duplicateGroups: findDuplicateGroups(listEntries(deps.journalRepo)),
    recycledEntries: listRecycledEntries(deps.journalRepo),
  };
}

export interface JournalEntryResult extends ActionResult {
  entry?: JournalEntry;
}

/**
 * One full entry, for the viewer modal.
 *
 * The Duplicates rows carry whole entries with the **body blanked** (see
 * src/lib/journal/duplicates.ts) — the card can hold hundreds of rows, and
 * shipping every entry's content to open one of them would be the bulk of the
 * payload for none of the benefit. So the modal fetches the entry it is about
 * to show.
 */
export async function getJournalEntryAction(id: number): Promise<JournalEntryResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const entry = getEntry(deps.journalRepo, id);
    if (!entry) return { ok: false, error: `No journal entry with id ${id}.` };
    return { ok: true, entry };
  } catch (error) {
    return toErrorResult(error, "Failed to load that entry.");
  }
}
