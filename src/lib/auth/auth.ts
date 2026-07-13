import { getUserByGoogleEmail, verifyCredentials, type User, type UserRepository } from "@/lib/user";
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
 */
export function login(
  input: LoginInput,
  userRepo: UserRepository,
  sessionRepo: SessionRepository,
): { session: Session; user: User } | undefined {
  const parsed = loginSchema.parse(input);
  const user = verifyCredentials(parsed, userRepo);
  if (!user) return undefined;

  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  const session = sessionRepo.createSession(user.id, expiresAt);
  return { session, user };
}

export function logout(sessionId: string, sessionRepo: SessionRepository): void {
  sessionRepo.deleteSession(sessionId);
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

/**
 * Completes a Google sign-in: exchanges the authorization code, then
 * requires the returned email to be verified AND already linked (via User
 * Management) to an enabled account — unlinked Google accounts are never
 * auto-registered.
 */
export async function completeGoogleLogin(
  code: string,
  googleClient: GoogleOAuthClient,
  userRepo: UserRepository,
  sessionRepo: SessionRepository,
): Promise<{ session: Session; user: User } | undefined> {
  const info = await googleClient.exchangeCodeForUserInfo(code);
  if (!info.emailVerified) return undefined;

  const user = getUserByGoogleEmail(info.email, userRepo);
  if (!user || user.isDisabled) return undefined;

  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  const session = sessionRepo.createSession(user.id, expiresAt);
  return { session, user };
}
