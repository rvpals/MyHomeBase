import type { AuthEvent, AuthEventFilter, AuthEventSummary, NewAuthEvent } from "./types";

// The use-cases depend on THIS interface, not on a concrete database.
// That is what lets the web app, the CLI, and tests each supply their own.
export interface AuthEventRepository {
  /**
   * Appends one event. Never throws for a bad value — the caller is usually a login
   * attempt, and a broken audit write must not turn a valid sign-in into an error.
   * Validation happens in the use-case, before this is reached.
   */
  recordEvent(event: NewAuthEvent): void;
  /** Newest first, bounded by `filter.limit`. */
  listEvents(filter: AuthEventFilter): AuthEvent[];
  /** Counts for the security screen header, in one round trip. */
  getSummary(): AuthEventSummary;
  /**
   * Stamps `reviewed_at` on every failure that does not have it yet, up to and
   * including `asOf`. Bounded by a timestamp rather than "all", so a failure arriving
   * while an admin is reading the screen is not silently marked reviewed.
   */
  markFailuresReviewed(asOf: string, reviewedAt: string): void;
  /** Deletes events created before `cutoff` (ISO). Returns how many went. */
  deleteEventsBefore(cutoff: string): number;
}
