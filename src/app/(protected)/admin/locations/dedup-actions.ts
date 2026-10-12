"use server";

// Server actions for Admin → Locations → Location Manager's "Merging & Dedup"
// dialog.
//
// Its own file rather than more of actions.ts: dedup is one self-contained
// screen, and the merge action is the only write here that deletes library rows
// as a side effect of succeeding — worth keeping where it is easy to find.
//
// Thin adapters: authorise, call a `lib/sys-locations` use-case (which
// validates), revalidate, return.

import { revalidatePath } from "next/cache";
import {
  findLocationDuplicates,
  mergeSavedLocations,
  type LocationDuplicateGroup,
} from "@/lib/sys-locations";
import { deps } from "@/lib/wiring";
import { requireAdmin } from "@/app/(protected)/require-access";

const LOCATIONS_PATH = "/admin/locations";

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
  /**
   * How many rows were repointed at the survivor. Always 0 here: nothing
   * references these places yet — see migration 0140.
   */
  movedCount?: number;
  /** How many library rows were removed. */
  removedCount?: number;
}

function toErrorResult(error: unknown, fallback: string): DedupActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/** The same three screens `actions.ts` refreshes, for the same reason. */
function revalidateLocationScreens(): void {
  revalidatePath(`${LOCATIONS_PATH}/manager`);
  revalidatePath(`${LOCATIONS_PATH}/map`);
  revalidatePath(`${LOCATIONS_PATH}/metadata`);
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
  maxMetres?: number,
): Promise<DuplicateGroupsResult> {
  await requireAdmin();
  try {
    return {
      ok: true,
      groups: findLocationDuplicates(deps.sysLocationRepo, threshold, maxMetres),
    };
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
  maxMetres?: number,
): Promise<MergeLocationsActionResult> {
  await requireAdmin();
  try {
    const { movedCount, removedCount } = mergeSavedLocations(deps.sysLocationRepo, {
      keepId,
      removeIds,
    });
    revalidateLocationScreens();
    return {
      ok: true,
      movedCount,
      removedCount,
      groups: findLocationDuplicates(deps.sysLocationRepo, threshold, maxMetres),
    };
  } catch (error) {
    return toErrorResult(error, "Failed to merge those locations.");
  }
}
