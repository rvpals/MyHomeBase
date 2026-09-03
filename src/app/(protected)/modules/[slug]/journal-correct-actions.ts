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
  recycleEntries,
  restoreRecycledEntries,
} from "@/lib/journal";
import type { DuplicateGroup, JournalEntry, RecycledJournalEntry } from "@/lib/journal";
import { deps } from "@/lib/wiring";

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
 * A single action rather than one per card because every mutation here changes
 * both lists at once — recycling a duplicate removes it from the Duplicates
 * card and adds it to the bin — so the views must never be refreshed
 * independently or they will disagree about where an entry is.
 */
export interface CorrectDataResult extends ActionResult {
  duplicateGroups?: DuplicateGroup[];
  recycledEntries?: RecycledJournalEntry[];
}

export async function loadJournalCorrectDataAction(): Promise<CorrectDataResult> {
  try {
    return { ok: true, ...readCorrectData() };
  } catch (error) {
    return toErrorResult(error, "Failed to load the Correct tab.");
  }
}

export interface RecycleEntriesResult extends CorrectDataResult {
  movedCount?: number;
  skippedCount?: number;
}

/**
 * Moves the ticked entries into the recycle bin.
 *
 * Returns the refreshed lists alongside the counts, so the view re-renders from
 * server truth rather than patching its own state — the entries it just deleted
 * are gone from one card and present in the other, and a locally-applied guess
 * would be one of the two lists out of date.
 */
export async function recycleJournalEntriesAction(ids: number[]): Promise<RecycleEntriesResult> {
  try {
    const { movedCount, skippedCount } = recycleEntries(deps.journalRepo, ids);
    revalidatePath(JOURNAL_MODULE_PATH);
    return { ok: true, movedCount, skippedCount, ...readCorrectData() };
  } catch (error) {
    return toErrorResult(error, "Failed to delete the selected entries.");
  }
}

export interface RestoreEntriesResult extends CorrectDataResult {
  restoredCount?: number;
  skippedCount?: number;
}

export async function restoreJournalEntriesAction(
  recycledIds: number[],
): Promise<RestoreEntriesResult> {
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
  try {
    const { deletedCount } = deleteRecycledEntriesForever(deps.journalRepo, recycledIds);
    revalidatePath(JOURNAL_MODULE_PATH);
    return { ok: true, deletedCount, ...readCorrectData() };
  } catch (error) {
    return toErrorResult(error, "Failed to delete the selected entries forever.");
  }
}

export async function emptyRecycleBinAction(): Promise<PurgeEntriesResult> {
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
 * sitting in 2019. The excerpt is cut to 100 words in the library before this
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
 * The Duplicates list carries a 100-word excerpt rather than whole entries — the
 * card can hold hundreds of rows, and shipping every entry's full content to
 * open one of them would be the bulk of the payload for none of the benefit. So
 * the modal fetches the entry it is about to show.
 */
export async function getJournalEntryAction(id: number): Promise<JournalEntryResult> {
  try {
    const entry = getEntry(deps.journalRepo, id);
    if (!entry) return { ok: false, error: `No journal entry with id ${id}.` };
    return { ok: true, entry };
  } catch (error) {
    return toErrorResult(error, "Failed to load that entry.");
  }
}
