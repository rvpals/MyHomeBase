import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { getModuleBySlug } from "@/lib/modules";
import { isAdmin, userHasModuleAccess } from "@/lib/user";
import type { User } from "@/lib/user";
import { deps } from "@/lib/wiring";

/**
 * The server-action half of access control.
 *
 * The module routes check `userHasModuleAccess` when they render, but a server
 * action is a POST endpoint of its own: neither the `(protected)` layout's
 * session redirect nor the page's own check runs before one fires. Hiding a
 * module from the rail therefore does nothing to stop a caller invoking that
 * module's actions directly, which is what these guards close.
 *
 * `requireAdmin` here is the same rule the four admin action files each declared
 * privately; they now share this one. See `src/app/(protected)/admin/actions.ts`
 * for the comment that first described the hole.
 */

/**
 * Resolves the signed-in user, or throws.
 *
 * Exported for the home-screen widget actions, which no module owns: every signed-in
 * reader sees those widgets, so a session is the whole rule there.
 */
export async function requireUser(): Promise<User> {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) throw new Error("You must be signed in.");
  return currentUser;
}

/** Rejects a caller who isn't an admin. */
export async function requireAdmin(): Promise<User> {
  const currentUser = await requireUser();
  if (!isAdmin(currentUser)) throw new Error("Administrators only.");
  return currentUser;
}

/**
 * Rejects a caller who hasn't been granted the module named by `slug`.
 *
 * `slug` is matched **exactly**: it is passed to `getModuleBySlug`, which is a
 * `WHERE slug = ?` equality lookup. Nothing here does prefix or `startsWith`
 * matching, deliberately — a prefix test would let `stock-etfs` authorise a
 * future `stock-etfs-pro`, and would make `journal` authorise anything merely
 * beginning with it. Pass the module's own full slug, never a route path: the
 * paths are not slugs and some are deeper than one segment (for instance
 * `/modules/journal/metadata`).
 *
 * Admins pass by role, so a module added after their account was created needs
 * no backfilled grant — the same rule `getAccessibleModules` applies.
 */
export async function requireModuleAccess(slug: string): Promise<User> {
  const currentUser = await requireUser();

  const appModule = getModuleBySlug(deps.moduleRepo, slug);
  // An unknown slug is a programming error in the caller, not a denied user:
  // failing loudly stops a typo'd slug from silently authorising everyone.
  if (!appModule) throw new Error(`No module with the slug "${slug}".`);

  if (!userHasModuleAccess(currentUser, appModule.id, deps.userRepo)) {
    throw new Error("You don't have access to this module.");
  }
  return currentUser;
}
