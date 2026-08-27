// The public surface of this module.
//
// NOTE ON IMPORTING THIS FROM A CLIENT COMPONENT: don't. This index re-exports
// the `deps`-backed prune runner, so pulling it into a `"use client"` file drags
// better-sqlite3 and `node:fs` into the browser bundle and the build fails with
// "the chunking context does not support external modules (request: node:fs)".
// Client components import from the leaf modules instead -- `./types` for the
// types, `./auth-events` for the pure helpers like `describeFailureReason`.
// See `admin/security/view.tsx`, and the identical note in
// `@/lib/scheduled-refresh/index.ts`.

export type {
  AuthEvent,
  AuthEventContext,
  AuthEventFilter,
  AuthEventSummary,
  AuthEventType,
  AuthFailureReason,
  NewAuthEvent,
} from "./types";
export {
  authEventFilterSchema,
  authEventSchema,
  newAuthEventSchema,
  retentionDaysSchema,
  type AuthEventFilterInput,
  type NewAuthEventInput,
} from "./schema";
export type { AuthEventRepository } from "./ports";
export {
  AUTH_EVENT_PRUNE_JOB_KEY,
  PRUNE_INTERVAL_MINUTES,
  loadLastPruneRun,
  runAuthEventPruneNow,
  shouldPruneNow,
  type AuthEventPruneSummary,
} from "./prune-runner";
export { AUTH_EVENT_TYPES } from "./repository";
export {
  DEFAULT_RETENTION_DAYS,
  describeFailureReason,
  getAuthEventSummary,
  hasUnreviewedFailures,
  listAuthEvents,
  markFailuresReviewed,
  pruneAuthEvents,
  recordAuthEvent,
  recordLoginFailure,
  recordLoginSuccess,
  recordLogout,
  toSqliteTimestamp,
} from "./auth-events";
