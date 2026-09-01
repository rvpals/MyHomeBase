"use server";

import { revalidatePath } from "next/cache";
import { deleteDeployment } from "@/lib/deployments";
import { deps } from "@/lib/wiring";

export interface ActionResult {
  ok: boolean;
  error?: string;
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
