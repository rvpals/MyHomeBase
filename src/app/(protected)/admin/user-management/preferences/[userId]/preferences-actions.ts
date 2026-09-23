"use server";

import { revalidatePath } from "next/cache";
import { invalidateSessionsForUser } from "@/lib/auth";
import { listModules } from "@/lib/modules";
import {
  MAX_AVATAR_BYTES,
  clearUserAvatar,
  getAccessibleModules,
  getUserById,
  setUserAvatar,
  setUserPassword,
} from "@/lib/user";
import type { User } from "@/lib/user";
import {
  saveFloatingCorner,
  saveFloatingState,
  saveUserPreferences,
  type FloatingCornerUpdate,
  type FloatingStateUpdate,
  type UserPreferencesUpdate,
} from "@/lib/user-preferences";
import { deps } from "@/lib/wiring";
import { requireAdmin } from "../../../../require-access";

/**
 * The admin-guarded twins of the Account screen's `*Own*` actions.
 *
 * Each one is the same use-case call as its counterpart in
 * `src/app/(protected)/account/actions.ts`, with exactly one difference: the subject
 * is an explicit `userId` argument instead of the session cookie. That difference is
 * why these are separate files rather than one set of actions with an optional id —
 * "who may I write to" is the one part of an action that must never be factored away,
 * and an optional id on the self-serve actions would be an escalation waiting to
 * happen. The Journal's `searchPlacesAction` is duplicated from the home screen's for
 * the same reason.
 *
 * **Every export starts with `requireAdmin()`.** An action is its own POST endpoint:
 * the `/admin` layout redirects a non-admin who *renders* the page, but nothing in
 * that layout runs before one of these fires, so the guard has to be here.
 *
 * The id is then resolved through `resolveTarget`, so a stale or hand-typed id is
 * refused rather than writing orphaned preference rows against an account that does
 * not exist.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/**
 * Admin check, then the target account.
 *
 * Both halves matter and they fail differently: a non-admin caller throws out of
 * `requireAdmin` (caught by each action as an error result), while an unknown id
 * returns `undefined` so the action can say "that user no longer exists" rather than
 * reporting a permission problem for what is really a stale page.
 */
async function resolveTarget(userId: number): Promise<User | undefined> {
  await requireAdmin();
  if (!Number.isInteger(userId) || userId <= 0) return undefined;
  return getUserById(userId, deps.userRepo);
}

/** Revalidates the admin screen; the avatar and preferences also show app-wide. */
function revalidateFor(userId: number): void {
  revalidatePath(`/admin/user-management/preferences/${userId}`);
  revalidatePath("/admin/user-management");
}

export async function adminUploadAvatarAction(formData: FormData): Promise<ActionResult> {
  try {
    // The id rides in the form body rather than as a second argument, because the
    // caller is a `<form>` submit handing over its own `FormData` — the same shape
    // the user-list uploader uses.
    const userId = Number(formData.get("userId"));
    const target = await resolveTarget(userId);
    if (!target) return { ok: false, error: "That user no longer exists." };

    const file = formData.get("avatar");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Choose an image first." };
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return {
        ok: false,
        error: `That image is ${Math.round(file.size / 1024)} KB — keep it under ${Math.round(
          MAX_AVATAR_BYTES / 1024,
        )} KB.`,
      };
    }

    const data = Buffer.from(await file.arrayBuffer());
    setUserAvatar(target.id, { data, mimeType: file.type }, deps.userRepo);
    revalidateFor(target.id);
    // The avatar shows in the header and the rail on every page, so the whole
    // layout tree is stale once it changes — same call the user-list uploader makes.
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Failed to upload image.");
  }
}

export async function adminRemoveAvatarAction(userId: number): Promise<ActionResult> {
  try {
    const target = await resolveTarget(userId);
    if (!target) return { ok: false, error: "That user no longer exists." };

    clearUserAvatar(target.id, deps.userRepo);
    revalidateFor(target.id);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Failed to remove image.");
  }
}

/**
 * Sets another account's password.
 *
 * Unlike `changeOwnPasswordAction`, this invalidates the target's sessions — the
 * same thing the user-list's `setUserPasswordAction` does. An admin changing
 * somebody else's password is either resetting a forgotten one or locking out
 * whoever currently holds it; leaving their existing sessions signed in would
 * defeat the second case entirely.
 */
export async function adminChangePasswordAction(
  userId: number,
  password: string,
): Promise<ActionResult> {
  try {
    const target = await resolveTarget(userId);
    if (!target) return { ok: false, error: "That user no longer exists." };

    setUserPassword(target.id, { password }, deps.userRepo);
    invalidateSessionsForUser(target.id, deps.sessionRepo);
    revalidateFor(target.id);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Failed to change password.");
  }
}

/**
 * Saves another account's preferences.
 *
 * The allowed favorites are re-derived here from the *target's* access, not the
 * admin's, and not from whatever the picker sent. That is the same re-derivation
 * `saveOwnPreferencesAction` does and it matters more here: an admin can reach every
 * module, so trusting the submitted list would let one set a favorite pointing at a
 * module the target cannot open — stranding them on a dead-end startup redirect with
 * no way back to the screen that would fix it.
 */
export async function adminSavePreferencesAction(
  userId: number,
  input: UserPreferencesUpdate,
): Promise<ActionResult> {
  try {
    const target = await resolveTarget(userId);
    if (!target) return { ok: false, error: "That user no longer exists." };

    const accessibleModules = getAccessibleModules(
      target,
      listModules(deps.moduleRepo),
      deps.userRepo,
    );
    saveUserPreferences(
      deps.userPreferencesRepo,
      target.id,
      input,
      accessibleModules.map((appModule) => appModule.slug),
    );
    revalidateFor(target.id);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Failed to save preferences.");
  }
}

/**
 * Sets the shape one of the target's floating components is in.
 *
 * This is the reason the Floating Components panel is worth showing here at all: `✕`
 * is final on the window itself, so a reader who dismissed their clock and cannot
 * find the Account screen needs someone able to put it back.
 *
 * `revalidateFor` rather than the self-serve action's deliberate no-revalidate: that
 * one fires on every minimize and restore, where re-rendering the app would be waste.
 * This one fires when an admin clicks a radio, which is rare, and the admin's own
 * floating layer must *not* change — only the stored row for the target.
 */
export async function adminSaveFloatingStateAction(
  userId: number,
  input: FloatingStateUpdate,
): Promise<ActionResult> {
  try {
    const target = await resolveTarget(userId);
    if (!target) return { ok: false, error: "That user no longer exists." };

    saveFloatingState(deps.userPreferencesRepo, target.id, input);
    revalidateFor(target.id);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Failed to save the floating component's state.");
  }
}

/** Where the target's puck docks. Same guards and reasoning as the state above. */
export async function adminSaveFloatingCornerAction(
  userId: number,
  input: FloatingCornerUpdate,
): Promise<ActionResult> {
  try {
    const target = await resolveTarget(userId);
    if (!target) return { ok: false, error: "That user no longer exists." };

    saveFloatingCorner(deps.userPreferencesRepo, target.id, input);
    revalidateFor(target.id);
    return { ok: true };
  } catch (error) {
    return toErrorResult(error, "Failed to save the corner.");
  }
}
