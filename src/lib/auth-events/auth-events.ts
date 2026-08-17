import { toSqliteTimestampUtc } from "@/lib/shared/date";
import type { AuthEventRepository } from "./ports";
import {
  authEventFilterSchema,
  newAuthEventSchema,
  retentionDaysSchema,
} from "./schema";
import type {
  AuthEvent,
  AuthEventContext,
  AuthEventFilter,
  AuthEventSummary,
  AuthFailureReason,
  NewAuthEvent,
} from "./types";

/** Rows older than this are deleted by the prune heartbeat. */
export const DEFAULT_RETENTION_DAYS = 90;

/**
 * The formatter for any value compared against `created_at`, which defaults to
 * `datetime('now')` (migrations/0045). Aliased from the shared helper so callers in
 * this module and its adapters have one obvious name to reach for.
 */
export const toSqliteTimestamp = toSqliteTimestampUtc;

/**
 * Appends one event.
 *
 * Swallows its own errors on purpose. Every caller is a live authentication attempt,
 * and an audit-trail write that throws would turn a valid sign-in into a failed one —
 * losing a log line is bad, refusing a legitimate login because logging broke is
 * worse. The failure goes to the console so it is not silent.
 */
export function recordAuthEvent(input: NewAuthEvent, repo: AuthEventRepository): void {
  try {
    repo.recordEvent(newAuthEventSchema.parse(input));
  } catch (error) {
    console.error("[auth-events] failed to record an event:", error);
  }
}

/** Records a successful password or Google sign-in. */
export function recordLoginSuccess(
  attemptedUsername: string,
  userId: number,
  context: AuthEventContext,
  repo: AuthEventRepository,
): void {
  recordAuthEvent(
    { eventType: "login_success", attemptedUsername, userId, ...context },
    repo,
  );
}

/**
 * Records a failed sign-in, including why. The reason is deliberately richer than
 * what the browser is told — see migrations/0045.
 */
export function recordLoginFailure(
  attemptedUsername: string,
  reason: AuthFailureReason,
  context: AuthEventContext,
  repo: AuthEventRepository,
  userId?: number,
): void {
  recordAuthEvent(
    {
      eventType: "login_failure",
      attemptedUsername,
      failureReason: reason,
      userId,
      ...context,
    },
    repo,
  );
}

export function recordLogout(
  userId: number | undefined,
  context: AuthEventContext,
  repo: AuthEventRepository,
): void {
  recordAuthEvent({ eventType: "logout", userId, ...context }, repo);
}

/** The security screen's list. Validates and bounds the filter before reading. */
export function listAuthEvents(
  filter: AuthEventFilter,
  repo: AuthEventRepository,
): AuthEvent[] {
  return repo.listEvents(authEventFilterSchema.parse(filter));
}

export function getAuthEventSummary(repo: AuthEventRepository): AuthEventSummary {
  return repo.getSummary();
}

/**
 * True when an admin should be warned. Drives the home-screen alert, which asks about
 * the *facts* rather than whether a message was dismissed — so no user can clear it
 * for everyone else, and it returns the moment a new failure lands.
 */
export function hasUnreviewedFailures(repo: AuthEventRepository): boolean {
  return repo.getSummary().unreviewedFailures > 0;
}

/**
 * Acknowledges every failure that exists *now*. `asOf` defaults to the current time
 * and bounds the update, so a failure arriving while the admin reads the screen stays
 * unreviewed instead of being cleared unseen.
 */
export function markFailuresReviewed(
  repo: AuthEventRepository,
  asOf: Date = new Date(),
): void {
  const stamp = toSqliteTimestamp(asOf);
  repo.markFailuresReviewed(stamp, stamp);
}

/**
 * Deletes events past the retention window. Returns how many were removed so the
 * caller can log a meaningful line (and log nothing when there was nothing to do).
 */
export function pruneAuthEvents(
  repo: AuthEventRepository,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
  now: Date = new Date(),
): number {
  const days = retentionDaysSchema.parse(retentionDays);
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return repo.deleteEventsBefore(toSqliteTimestamp(cutoff));
}

/** Human wording for the admin screen. Kept here so the web and CLI agree. */
export function describeFailureReason(reason: AuthFailureReason): string {
  switch (reason) {
    case "unknown_user":
      return "No such username";
    case "bad_password":
      return "Wrong password";
    case "account_disabled":
      return "Account disabled";
    case "invalid_input":
      return "Incomplete submission";
  }
}
