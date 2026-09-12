"use server";

import { revalidatePath } from "next/cache";
import { listLogEntries, recycleEntries } from "@/lib/journal";
import type { JournalEntry } from "@/lib/journal";
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

export interface LogEntriesResult extends ActionResult {
  entries?: JournalEntry[];
}

/** The Log list, re-read from the server. */
export async function loadLogEntriesAction(): Promise<LogEntriesResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    return { ok: true, entries: listLogEntries(deps.journalRepo) };
  } catch (error) {
    return toErrorResult(error, "Failed to load the log.");
  }
}

export interface DeleteLogEntriesResult extends LogEntriesResult {
  movedCount?: number;
  skippedCount?: number;
}

/**
 * Moves the ticked log entries into the recycle bin.
 *
 * The bin, not a hard delete — same as the Correct tab's delete, and for the
 * same reason: a mis-ticked row in a list of hundreds of imported rows has to be
 * recoverable. They are restorable from Data Management → CSV Import → Correct.
 *
 * Returns the refreshed list so the view re-renders from server truth rather
 * than patching its own copy.
 */
export async function deleteLogEntriesAction(ids: number[]): Promise<DeleteLogEntriesResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);
  try {
    const { movedCount, skippedCount } = recycleEntries(deps.journalRepo, ids);
    revalidatePath(JOURNAL_MODULE_PATH);
    return {
      ok: true,
      movedCount,
      skippedCount,
      entries: listLogEntries(deps.journalRepo),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to delete the selected log entries.");
  }
}
