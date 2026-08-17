"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { markFailuresReviewed } from "@/lib/auth-events";
import { isAdmin } from "@/lib/user";
import { deps } from "@/lib/wiring";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * The sign-in log is admin-only. The route layout already redirects non-admins, but a
 * server action is its own endpoint — callable without ever rendering the page — so
 * the check has to live on this side too (same reasoning as user-management).
 */
async function requireAdmin(): Promise<void> {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) throw new Error("Not authenticated.");
  if (!isAdmin(currentUser)) throw new Error("Only an admin can review sign-in activity.");
}

/**
 * Acknowledges every failure that exists right now, which is what clears the
 * home-screen warning. Bounded to this instant by the use-case, so a failure arriving
 * while the page was open stays unreviewed rather than being cleared unseen.
 */
export async function markFailuresReviewedAction(): Promise<ActionResult> {
  try {
    await requireAdmin();
    markFailuresReviewed(deps.authEventRepo);
    // Both the log and the home-screen alert read this state.
    revalidatePath("/admin/security");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to mark the attempts as reviewed.",
    };
  }
}
