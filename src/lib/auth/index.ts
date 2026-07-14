export type { Session } from "./types";
export { loginSchema, type LoginInput } from "./schema";
export type { SessionRepository, GoogleOAuthClient, GoogleUserInfo } from "./ports";
export { GoogleAuthClient, type GoogleAuthClientConfig } from "./google-client";
export {
  SESSION_DURATION_MS,
  SESSION_COOKIE_NAME,
  login,
  logout,
  getCurrentUser,
  invalidateSessionsForUser,
  completeGoogleLogin,
  type GoogleLoginResult,
  type GoogleLoginFailureReason,
} from "./auth";
