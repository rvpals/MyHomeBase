"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE_NAME, getCurrentUser, invalidateSessionsForUser } from "@/lib/auth";
import {
  createUser,
  deleteUser,
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

async function getActingUserId(): Promise<number> {
  const sessionId = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const currentUser = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
  if (!currentUser) throw new Error("Not authenticated.");
  return currentUser.id;
}

function toErrorResult(error: unknown, fallback: string): ActionResult {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

export async function createUserAction(input: CreateUserInput): Promise<ActionResult> {
  try {
    createUser(input, deps.userRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to create user.");
  }
  revalidatePath("/admin/user-management");
  return { ok: true };
}

export async function setUserPasswordAction(userId: number, password: string): Promise<ActionResult> {
  try {
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
    const actingUserId = await getActingUserId();
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
    const actingUserId = await getActingUserId();
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
    const actingUserId = await getActingUserId();
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
    setUserGoogleEmail(userId, { googleEmail: googleEmail ?? undefined }, deps.userRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to update Google account link.");
  }
  revalidatePath("/admin/user-management");
  return { ok: true };
}

export async function setUserModuleAccessAction(
  userId: number,
  moduleIds: number[],
): Promise<ActionResult> {
  try {
    setUserModuleAccess(userId, moduleIds, deps.userRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to update module access.");
  }
  revalidatePath("/admin/user-management");
  return { ok: true };
}
