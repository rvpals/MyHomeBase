"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE_NAME, getCurrentUser } from "@/lib/auth";
import { clearUserAvatar, setUserAvatar, setUserPassword } from "@/lib/user";
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

export async function uploadOwnAvatarAction(formData: FormData): Promise<ActionResult> {
  try {
    const userId = await getActingUserId();
    const file = formData.get("avatar");
    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, error: "Choose an image first." };
    }
    const data = Buffer.from(await file.arrayBuffer());
    setUserAvatar(userId, { data, mimeType: file.type }, deps.userRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to upload image.");
  }
  revalidatePath("/account");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeOwnAvatarAction(): Promise<ActionResult> {
  try {
    const userId = await getActingUserId();
    clearUserAvatar(userId, deps.userRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to remove image.");
  }
  revalidatePath("/account");
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function changeOwnPasswordAction(password: string): Promise<ActionResult> {
  try {
    const userId = await getActingUserId();
    setUserPassword(userId, { password }, deps.userRepo);
  } catch (error) {
    return toErrorResult(error, "Failed to change password.");
  }
  return { ok: true };
}
