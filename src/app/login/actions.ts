"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, login, logout } from "@/lib/auth";
import { deps } from "@/lib/wiring";

export interface LoginResult {
  ok: boolean;
  error?: string;
}

export async function loginAction(input: { username: string; password: string }): Promise<LoginResult> {
  let result;
  try {
    result = login(input, deps.userRepo, deps.sessionRepo);
  } catch {
    return { ok: false, error: "Invalid username or password." };
  }

  if (!result) {
    return { ok: false, error: "Invalid username or password." };
  }

  (await cookies()).set(SESSION_COOKIE_NAME, result.session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(result.session.expiresAt),
  });

  redirect("/");
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE_NAME)?.value;
  if (sessionId) logout(sessionId, deps.sessionRepo);
  store.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}
