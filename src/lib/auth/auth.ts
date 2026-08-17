import {
  recordLoginFailure,
  recordLoginSuccess,
  recordLogout,
  type AuthEventContext,
  type AuthEventRepository,
} from "@/lib/auth-events";
import {
  createUserFromGoogle,
  getUserByGoogleEmail,
  recordUserLogin,
  verifyCredentialsDetailed,
  type User,
  type UserRepository,
} from "@/lib/user";
import type { GoogleOAuthClient, SessionRepository } from "./ports";
import { loginSchema, type LoginInput } from "./schema";
import type { Session } from "./types";

export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_NAME = "myhomebase_session";

function isExpired(session: Session): boolean {
  return new Date(session.expiresAt).getTime() <= Date.now();
}

/**
 * Validates credentials and starts a session. Deliberately doesn't
 * distinguish "unknown username" from "wrong password" in its result —
 * avoids leaking which usernames exist.
 *
 * When `audit` is supplied, the *reason* for a failure is written to the audit trail
 * even though the caller still receives a bare `undefined`. That asymmetry is the
 * point: the operator gets to tell a typo from a systematic guess, while the browser
 * learns nothing (see migrations/0045). A success also stamps `last_login_at`.
 *
 * `audit` is optional so the CLI and tests can call `login` without a recorder.
 */
export function login(
  input: LoginInput,
  userRepo: UserRepository,
  sessionRepo: SessionRepository,
  audit?: { repo: AuthEventRepository; context?: AuthEventContext },
): { session: Session; user: User } | undefined {
  // Parsed inside the try-equivalent: an invalid submission is still an attempt worth
  // recording, and the raw username is what was typed.
  let parsed: LoginInput;
  try {
    parsed = loginSchema.parse(input);
  } catch (error) {
    if (audit) {
      recordLoginFailure(
        typeof input?.username === "string" ? input.username : "",
        "invalid_input",
        audit.context ?? {},
        audit.repo,
      );
    }
    throw error;
  }

  const check = verifyCredentialsDetailed(parsed, userRepo);
  if (!check.ok) {
    if (audit) {
      recordLoginFailure(
        parsed.username,
        check.reason,
        audit.context ?? {},
        audit.repo,
        check.userId,
      );
    }
    return undefined;
  }

  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  const session = sessionRepo.createSession(check.user.id, expiresAt);

  if (audit) {
    recordLoginSuccess(parsed.username, check.user.id, audit.context ?? {}, audit.repo);
  }
  // Denormalised copy for the user-management screen. After the event so a failure
  // here can't cost us the event row, and swallowed for the same reason the recorder
  // swallows: a bookkeeping write must never turn a valid sign-in into a failed one.
  try {
    recordUserLogin(check.user.id, userRepo);
  } catch (error) {
    console.error("[auth] failed to stamp last_login_at:", error);
  }

  return { session, user: check.user };
}

/**
 * Ends a session. `audit` is optional; `userId` is passed in because the caller
 * already resolved it from the cookie and this function only has the session id.
 */
export function logout(
  sessionId: string,
  sessionRepo: SessionRepository,
  audit?: { repo: AuthEventRepository; context?: AuthEventContext; userId?: number },
): void {
  sessionRepo.deleteSession(sessionId);
  if (audit) recordLogout(audit.userId, audit.context ?? {}, audit.repo);
}

/**
 * Resolves a session cookie value to the logged-in user. An expired session
 * or a disabled account is treated as "not logged in" (and the stale
 * session row is cleaned up).
 */
export function getCurrentUser(
  sessionId: string | undefined,
  sessionRepo: SessionRepository,
  userRepo: UserRepository,
): User | undefined {
  if (!sessionId) return undefined;

  const session = sessionRepo.getSessionById(sessionId);
  if (!session) return undefined;

  if (isExpired(session)) {
    sessionRepo.deleteSession(sessionId);
    return undefined;
  }

  const user = userRepo.getUserById(session.userId);
  if (!user || user.isDisabled) return undefined;

  return user;
}

/** Force-logs-out a user — call after a password/role/disable/delete change. */
export function invalidateSessionsForUser(userId: number, sessionRepo: SessionRepository): void {
  sessionRepo.deleteSessionsForUser(userId);
}

export type GoogleLoginFailureReason = "unverified_email" | "account_disabled";

export type GoogleLoginResult =
  | { ok: true; session: Session; user: User }
  | { ok: false; reason: GoogleLoginFailureReason };

/**
 * Completes a Google sign-in: exchanges the authorization code, requires a
 * verified email, then either signs in the user already linked to that
 * email or — if no account is linked yet — auto-creates a fresh `user`-role
 * account for it (any Google account may sign in; there's no allow-list).
 * A linked-but-disabled account is rejected rather than re-enabled.
 */
export async function completeGoogleLogin(
  code: string,
  googleClient: GoogleOAuthClient,
  userRepo: UserRepository,
  sessionRepo: SessionRepository,
): Promise<GoogleLoginResult> {
  const info = await googleClient.exchangeCodeForUserInfo(code);
  if (!info.emailVerified) return { ok: false, reason: "unverified_email" };

  let user = getUserByGoogleEmail(info.email, userRepo);
  if (user) {
    if (user.isDisabled) return { ok: false, reason: "account_disabled" };
  } else {
    user = createUserFromGoogle({ googleEmail: info.email, fullName: info.name }, userRepo);
  }

  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  const session = sessionRepo.createSession(user.id, expiresAt);

  // Stamped for Google sign-ins too, so `last_login_at` means "last got in" rather
  // than "last got in with a password". Google *failures* are deliberately not
  // recorded as auth events — see migrations/0045.
  try {
    recordUserLogin(user.id, userRepo);
  } catch (error) {
    console.error("[auth] failed to stamp last_login_at:", error);
  }

  return { ok: true, session, user };
}
