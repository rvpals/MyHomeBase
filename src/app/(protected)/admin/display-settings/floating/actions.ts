"use server";

import { revalidatePath } from "next/cache";
import { setEnabledFloating } from "@/lib/floating";
import { deps } from "@/lib/wiring";
import { requireAdmin } from "../../../require-access";

export interface SaveFloatingEnabledResult {
  ok: boolean;
  error?: string;
}

/**
 * Stores which floating components are available to the household.
 *
 * `requireAdmin()` on the first line. The `/admin` layout already redirects a
 * non-admin, which covers the *screen* but not this endpoint: a server action is its
 * own POST route, reachable by anyone who can post to it.
 *
 * Validation — that every id names a component this build knows — belongs to the lib's
 * `setEnabledFloating`, not to this adapter. It throws on a bad payload and the catch
 * turns that into a message the form can show.
 */
export async function saveFloatingEnabledAction(
  ids: string[],
): Promise<SaveFloatingEnabledResult> {
  try {
    await requireAdmin();
    setEnabledFloating(deps.settingsRepo, ids);
    // "layout" because the floating layer is mounted by the protected layout, which
    // every page in the app shares — not by this route.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to save the floating components.",
    };
  }
}
