"use server";

// Server actions for the Location Manager's "Merging & Dedup" dialog.
//
// Its own file rather than more of journal-locations-actions.ts: dedup is one
// self-contained screen, and the merge action is the only write in the module
// that deletes library rows as a side effect of succeeding — worth keeping
// where it is easy to find.
//
// Thin adapters, like every other action file here: authorise, call a
// `lib/journal-locations` use-case (which validates), revalidate, return.

import { revalidatePath } from "next/cache";
import {
  findLocationDuplicates,
  mergeSavedLocations,
  type LocationDuplicateGroup,
} from "@/lib/journal-locations";
import { deps } from "@/lib/wiring";
import { requireModuleAccess } from "../../require-access";

const JOURNAL_MODULE_PATH = "/modules/journal";
const JOURNAL_MODULE_SLUG = "journal";

export interface DedupActionResult {
  ok: boolean;
  error?: string;
}

export interface DuplicateGroupsResult extends DedupActionResult {
  groups?: LocationDuplicateGroup[];
}

export interface MergeLocationsActionResult extends DedupActionResult {
  /** The groups as they stand after the merge, so the dialog can re-render. */
  groups?: LocationDuplicateGroup[];
  /** How many journal entries were repointed at the survivor. */
  movedCount?: number;
  /** How many library rows were removed. */
  removedCount?: number;
}

function toErrorResult(error: unknown, fallback: string): DedupActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/** Same four screens `journal-locations-actions.ts` refreshes, for the same reason. */
function revalidateLocationScreens(): void {
  revalidatePath(`${JOURNAL_MODULE_PATH}/locations`);
  revalidatePath(`${JOURNAL_MODULE_PATH}/location-map`);
  revalidatePath(`${JOURNAL_MODULE_PATH}/location-metadata`);
  revalidatePath(`${JOURNAL_MODULE_PATH}/new-entry`);
}

/**
 * Scans the library for near-duplicate places at the given name threshold.
 *
 * An action rather than a page read because the dialog re-scans as the reader
 * moves the threshold slider, and because the scan should not cost anything on
 * a Location Manager visit that never opens the dialog.
 */
export async function findLocationDuplicatesAction(
  threshold: number,
): Promise<DuplicateGroupsResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    return { ok: true, groups: findLocationDuplicates(deps.savedLocationRepo, threshold) };
  } catch (error) {
    return toErrorResult(error, "Failed to scan for duplicate locations.");
  }
}

/**
 * Folds `removeIds` into `keepId` and re-scans.
 *
 * The fresh scan comes back with the result rather than being left to the
 * caller: a merge changes which groups still exist, and a dialog patching its
 * local copy would end up disagreeing with the database about what is left to
 * merge. Same reasoning as the Log view's delete.
 */
export async function mergeSavedLocationsAction(
  keepId: number,
  removeIds: number[],
  threshold: number,
): Promise<MergeLocationsActionResult> {
  await requireModuleAccess(JOURNAL_MODULE_SLUG);
  try {
    const { movedCount, removedCount } = mergeSavedLocations(deps.savedLocationRepo, {
      keepId,
      removeIds,
    });
    revalidateLocationScreens();
    return {
      ok: true,
      movedCount,
      removedCount,
      groups: findLocationDuplicates(deps.savedLocationRepo, threshold),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to merge those locations.");
  }
}
