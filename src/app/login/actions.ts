"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, getCurrentUser, login, logout } from "@/lib/auth";
import { DuplicateUsernameError, InvalidAdminSecretError, registerUser } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { readAuthEventContext } from "./request-context";

export interface LoginResult {
  ok: boolean;
  error?: string;
}

export interface RegisterInput {
  username: string;
  fullName: string;
  password: string;
  adminSecretKey?: string;
}

export async function registerAction(input: RegisterInput): Promise<LoginResult> {
  try {
    registerUser(input, deps.userRepo, deps.adminSignupSecret);
  } catch (error) {
    if (error instanceof DuplicateUsernameError || error instanceof InvalidAdminSecretError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Could not create the account. Check your details and try again." };
  }

  // No session is created — the visitor lands back on the login page to sign in.
  redirect("/login?registered=1");
}

export async function loginAction(input: { username: string; password: string }): Promise<LoginResult> {
  // Read once, before anything can fail, so both outcomes are recorded with the same
  // metadata. `login` records the event and the *reason* internally; everything
  // returned from here stays deliberately generic.
  const audit = { repo: deps.authEventRepo, context: await readAuthEventContext() };

  let result;
  try {
    result = login(input, deps.userRepo, deps.sessionRepo, audit);
  } catch {
    // A schema failure (blank field). `login` has already recorded it as
    // `invalid_input` — the visitor sees the same sentence as any other failure.
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
  if (sessionId) {
    // Resolved before the session is deleted — afterwards the id is unresolvable.
    const user = getCurrentUser(sessionId, deps.sessionRepo, deps.userRepo);
    logout(sessionId, deps.sessionRepo, {
      repo: deps.authEventRepo,
      context: await readAuthEventContext(),
      userId: user?.id,
    });
  }
  store.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}
