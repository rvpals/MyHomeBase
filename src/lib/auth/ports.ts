import type { Session } from "./types";

// The use-cases depend on THIS interface, not on a concrete database.
export interface SessionRepository {
  createSession(userId: number, expiresAt: string): Session;
  getSessionById(id: string): Session | undefined;
  deleteSession(id: string): void;
  deleteSessionsForUser(userId: number): void;
}

export interface GoogleUserInfo {
  email: string;
  emailVerified: boolean;
}

/**
 * The only place that talks to Google. `exchangeCodeForUserInfo` performs
 * the authorization-code exchange and reads the verified email back from
 * Google's own userinfo endpoint — no JWT/JWKS verification needed, since
 * both calls are trusted server-to-server HTTPS requests to Google.
 */
export interface GoogleOAuthClient {
  getAuthorizationUrl(state: string): string;
  exchangeCodeForUserInfo(code: string): Promise<GoogleUserInfo>;
}
