"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE_NAME, getCurrentUser, invalidateSessionsForUser } from "@/lib/auth";
import {
  MAX_AVATAR_BYTES,
  clearUserAvatar,
  createUser,
  deleteUser,
  isAdmin,
  setUserAvatar,
  setUserDisabled,
  setUserGoogleEmail,
  setUserModuleAccess,
  setUserPassword,
  setUserRole,
  type CreateUserInput,
  type UserRole,
} from "@/lib/user";
import { deps } from "@/lib/wiring";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Every action here acts on *someone else's* account, so the guard is both
 * checks: authenticated and an admin. The route layout already redirects
 * non-admins, but a server action is its own endpoint — callable without ever
 * rendering the page — so the check has to live on this side too.
 */
async function getActingAdminId(): Promise<number> {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) throw new Error("Not authenticated.");
  if (!isAdmin(currentUser)) throw new Error("Only an admin can manage users.");
  return currentUser.id;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export async function createUserAction(input: CreateUserInput): Promise<ActionResult> {
  try {
    await getActingAdminId();
    createUser(input, deps.userRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to create user.");
  }
  revalidatePath("/admin/user-management");
  return { ok: true };
}

export async function setUserPasswordAction(userId: number, password: string): Promise<ActionResult> {
  try {
    await getActingAdminId();
    setUserPassword(userId, { password }, deps.userRepo);
    invalidateSessionsForUser(userId, deps.sessionRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to set password.");
  }
  revalidatePath("/admin/user-management");
  return { ok: true };
}

export async function setUserRoleAction(userId: number, role: UserRole): Promise<ActionResult> {
  try {
    const actingUserId = await getActingAdminId();
    setUserRole(actingUserId, userId, role, deps.userRepo);
    invalidateSessionsForUser(userId, deps.sessionRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to change role.");
  }
  revalidatePath("/admin/user-management");
  return { ok: true };
}

export async function setUserDisabledAction(userId: number, isDisabled: boolean): Promise<ActionResult> {
  try {
    const actingUserId = await getActingAdminId();
    setUserDisabled(actingUserId, userId, isDisabled, deps.userRepo);
    invalidateSessionsForUser(userId, deps.sessionRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to update status.");
  }
  revalidatePath("/admin/user-management");
  return { ok: true };
}

export async function deleteUserAction(userId: number): Promise<ActionResult> {
  try {
    const actingUserId = await getActingAdminId();
    deleteUser(actingUserId, userId, deps.userRepo);
    invalidateSessionsForUser(userId, deps.sessionRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to delete user.");
  }
  revalidatePath("/admin/user-management");
  return { ok: true };
}

export async function setUserGoogleEmailAction(
  userId: number,
  googleEmail: string | null,
): Promise<ActionResult> {
  try {
    await getActingAdminId();
    setUserGoogleEmail(userId, { googleEmail: googleEmail ?? undefined }, deps.userRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to update Google account link.");
  }
  revalidatePath("/admin/user-management");
  return { ok: true };
}

/**
 * Sets any user's avatar on their behalf, for the admin who is looking at the
 * user list. The image arrives as multipart `FormData` rather than a base64
 * string argument, so a couple of megabytes don't have to be encoded in the
 * browser and inflated by a third on the way over — same shape as the module
 * carousel-image upload.
 */
export async function setUserAvatarAction(formData: FormData): Promise<ActionResult> {
  try {
    await getActingAdminId();

    const userId = Number(formData.get("userId"));
    if (!Number.isInteger(userId) || userId <= 0) return { ok: false, error: "Unknown user." };

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
    setUserAvatar(userId, { data, mimeType: file.type }, deps.userRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to upload image.");
  }
  revalidatePath("/admin/user-management");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function clearUserAvatarAction(userId: number): Promise<ActionResult> {
  try {
    await getActingAdminId();
    clearUserAvatar(userId, deps.userRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to clear avatar.");
  }
  revalidatePath("/admin/user-management");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setUserModuleAccessAction(
  userId: number,
  moduleIds: number[],
): Promise<ActionResult> {
  try {
    await getActingAdminId();
    setUserModuleAccess(userId, moduleIds, deps.userRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to update module access.");
  }
  revalidatePath("/admin/user-management");
  return { ok: true };
}
