"use server";

import { revalidatePath } from "next/cache";
import {
  DEPLOYMENTS_KEEP_COUNT,
  deleteDeployment,
  deleteDeployments,
  pruneDeployments,
} from "@/lib/deployments";
import { deps } from "@/lib/wiring";
import { requireAdmin } from "../../require-access";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** An `ActionResult` that also says how many rows went, so the view can report it. */
export interface DeleteCountResult extends ActionResult {
  deletedCount?: number;
}

/**
 * Deletes one row from the deployment history.
 *
 * A row that was already gone is reported as success, not failure: the id was well-formed
 * and the caller's intent ("this should not be in the list") holds either way. Two tabs on
 * the About screen, or a double-tap on a phone, should not surface an error. A malformed id
 * throws inside `deleteDeployment` and is returned as one.
 */
export async function deleteDeploymentAction(id: number): Promise<ActionResult> {
  try {
    await requireAdmin();
    deleteDeployment(deps.deploymentRepo, id);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to delete the deployment record.",
    };
  }
  revalidatePath("/admin/about");
  return { ok: true };
}

/**
 * Deletes the deployment records the reader ticked.
 *
 * Reports the number of rows actually removed rather than whether every id was present:
 * ids that had already gone are not a failure, for the same reason a single delete treats
 * them that way. A malformed or empty list throws inside `deleteDeployments` and comes back
 * as an error — both mean a broken caller, not an empty result.
 */
export async function deleteDeploymentsAction(ids: number[]): Promise<DeleteCountResult> {
  let deletedCount: number;
  try {
    await requireAdmin();
    deletedCount = deleteDeployments(deps.deploymentRepo, ids);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to delete the deployment records.",
    };
  }
  revalidatePath("/admin/about");
  return { ok: true, deletedCount };
}

/**
 * Deletes every deployment record but the newest `DEPLOYMENTS_KEEP_COUNT`.
 *
 * The keep count is fixed here rather than taken from the caller: it is a housekeeping
 * button, not a query, and an action that accepted any number would let a stray call clear
 * the history. The library function takes it as a parameter, so a control can be added
 * later without touching the logic.
 */
export async function pruneDeploymentsAction(): Promise<DeleteCountResult> {
  let deletedCount: number;
  try {
    await requireAdmin();
    deletedCount = pruneDeployments(deps.deploymentRepo, DEPLOYMENTS_KEEP_COUNT);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to clear the deployment history.",
    };
  }
  revalidatePath("/admin/about");
  return { ok: true, deletedCount };
}
