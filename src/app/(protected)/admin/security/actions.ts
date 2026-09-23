"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { deleteAuthEvents, markFailuresReviewed } from "@/lib/auth-events";
import {
  allowIpAddress,
  deleteSiteVisits,
  disallowIpAddress,
  markSuspiciousReviewed,
} from "@/lib/site-visits";
import { isAdmin } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { requireAdmin as requireAdminUser } from "../../require-access";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** A result that also reports how many rows the action touched. */
export interface CountResult extends ActionResult {
  count: number;
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

/** Both halves of the Security screen, plus the home-screen alerts that read them. */
function revalidateSecurity(): void {
  revalidatePath("/admin/security");
  revalidatePath("/");
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
    revalidateSecurity();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to mark the attempts as reviewed.",
    };
  }
}

/**
 * Deletes selected rows from the sign-in log.
 *
 * This is destructive and irreversible, and it removes security evidence — which is
 * exactly why it is admin-gated on its first line and why the screen confirms before
 * calling it. The prune (90 days) handles routine ageing; this is for an admin who
 * has looked at specific rows and wants them gone.
 */
export async function deleteAuthEventsAction(ids: number[]): Promise<CountResult> {
  try {
    await requireAdminUser();
    const count = deleteAuthEvents(ids, deps.authEventRepo);
    revalidateSecurity();
    return { ok: true, count };
  } catch (error) {
    return {
      ok: false,
      count: 0,
      error: error instanceof Error ? error.message : "Failed to delete the selected events.",
    };
  }
}

/** Acknowledges every suspicious arrival that exists right now. */
export async function markVisitsReviewedAction(): Promise<ActionResult> {
  try {
    await requireAdminUser();
    markSuspiciousReviewed(deps.siteVisitRepo);
    revalidateSecurity();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to mark the visits as reviewed.",
    };
  }
}

/** Deletes selected arrivals. Same reasoning as `deleteAuthEventsAction`. */
export async function deleteSiteVisitsAction(ids: number[]): Promise<CountResult> {
  try {
    await requireAdminUser();
    const count = deleteSiteVisits(ids, deps.siteVisitRepo);
    revalidateSecurity();
    return { ok: true, count };
  } catch (error) {
    return {
      ok: false,
      count: 0,
      error: error instanceof Error ? error.message : "Failed to delete the selected visits.",
    };
  }
}

/**
 * Vouches for one or more addresses, and re-scores their past arrivals.
 *
 * Takes a list because the grid's bulk action hands over whatever was ticked, and
 * ticked rows routinely share an address. `allowIpAddress` is idempotent, so the
 * duplicates collapse rather than erroring.
 *
 * Returns how many addresses were processed, not how many rows were re-scored — the
 * screen reports "3 addresses allowed", which is what the reader chose.
 */
export async function allowIpAddressesAction(
  addresses: { ipAddress: string; label?: string }[],
): Promise<CountResult> {
  try {
    const currentUser = await requireAdminUser();

    const seen = new Set<string>();
    for (const address of addresses) {
      const trimmed = address.ipAddress.trim();
      if (trimmed === "" || seen.has(trimmed)) continue;
      seen.add(trimmed);

      allowIpAddress(
        { ipAddress: trimmed, label: address.label, addedByUserId: currentUser.id },
        deps.ipAllowlistRepo,
        deps.siteVisitRepo,
      );
    }

    revalidateSecurity();
    return { ok: true, count: seen.size };
  } catch (error) {
    return {
      ok: false,
      count: 0,
      error: error instanceof Error ? error.message : "Failed to allow the selected addresses.",
    };
  }
}

/** Stops vouching for an address, and re-scores its arrivals against the live rules. */
export async function disallowIpAddressAction(
  id: number,
  ipAddress: string,
): Promise<CountResult> {
  try {
    await requireAdminUser();
    const count = disallowIpAddress(id, ipAddress, deps.ipAllowlistRepo, deps.siteVisitRepo);
    revalidateSecurity();
    return { ok: true, count };
  } catch (error) {
    return {
      ok: false,
      count: 0,
      error: error instanceof Error ? error.message : "Failed to remove the address.",
    };
  }
}
