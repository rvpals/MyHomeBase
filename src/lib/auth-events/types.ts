/** What happened. Google sign-in is not recorded — see migrations/0045. */
export type AuthEventType = "login_success" | "login_failure" | "logout";

/**
 * Why a login failed. Recorded even though the browser is told only "Invalid
 * username or password" — the response must not leak which usernames exist, while
 * an operator reading the log needs to tell a typo from a systematic guess.
 *
 * `invalid_input` means the submission failed schema validation (blank field), which
 * never reached a password check at all.
 */
export type AuthFailureReason =
  | "unknown_user"
  | "bad_password"
  | "account_disabled"
  | "invalid_input";

/** Request metadata the presentation layer gathers and passes in as plain data. */
export interface AuthEventContext {
  /** First `x-forwarded-for` hop. Advisory only — behind a reverse proxy it is whatever the proxy claims. */
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthEvent {
  id: number;
  eventType: AuthEventType;
  /** What was typed, not a resolved account. `undefined` when nothing was. */
  attemptedUsername?: string;
  /** Set on success, and on failures where the account was found but rejected. */
  userId?: number;
  failureReason?: AuthFailureReason;
  ipAddress?: string;
  userAgent?: string;
  /** When an admin acknowledged this failure. `undefined` while unreviewed. */
  reviewedAt?: string;
  createdAt: string;
}

/** A row to write. Shaped like the use-case's input, not like the table. */
export interface NewAuthEvent {
  eventType: AuthEventType;
  attemptedUsername?: string;
  userId?: number;
  failureReason?: AuthFailureReason;
  ipAddress?: string;
  userAgent?: string;
}

/** Filters for the admin security screen. Every field is optional — omitted means "no filter". */
export interface AuthEventFilter {
  eventType?: AuthEventType;
  /** Substring match on what was typed. */
  username?: string;
  /** Inclusive ISO date (`YYYY-MM-DD`) lower bound on `createdAt`. */
  since?: string;
  limit?: number;
}

/** The headline numbers on the security screen. */
export interface AuthEventSummary {
  totalFailures: number;
  unreviewedFailures: number;
  totalSuccesses: number;
  /** Newest unreviewed failure, for the home-screen alert wording. `undefined` when there are none. */
  latestFailureAt?: string;
}
