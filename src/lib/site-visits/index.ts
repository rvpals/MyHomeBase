// The public surface of this module.
//
// NOTE ON IMPORTING THIS FROM A CLIENT COMPONENT: don't. This index re-exports
// the `deps`-backed prune runner, so pulling it into a `"use client"` file drags
// better-sqlite3 and `node:fs` into the browser bundle and the build fails with
// "the chunking context does not support external modules (request: node:fs)".
// Client components import from the leaf modules instead -- `./types` for the
// types, `./suspicion` and `./grouping` for the pure helpers. See
// `admin/security/visits-tab.tsx`, and the identical note in
// `@/lib/auth-events/index.ts`.

export type {
  IpAllowlistEntry,
  IpHistory,
  NewIpAllowlistEntry,
  NewSiteVisit,
  ScoredVisit,
  SiteVisit,
  SiteVisitContext,
  SiteVisitFilter,
  SiteVisitSummary,
  SuspicionLevel,
  SuspicionSignal,
  VisitDayGroup,
  VisitWeekGroup,
} from "./types";
export {
  bulkIdsSchema,
  ipAllowlistEntrySchema,
  newIpAllowlistEntrySchema,
  newSiteVisitSchema,
  retentionDaysSchema,
  siteVisitFilterSchema,
  siteVisitSchema,
  type NewIpAllowlistEntryInput,
  type NewSiteVisitInput,
  type SiteVisitFilterInput,
} from "./schema";
export type { IpAllowlistRepository, SiteVisitRepository } from "./ports";
export {
  PRUNE_INTERVAL_MINUTES,
  SITE_VISIT_PRUNE_JOB_KEY,
  loadLastPruneRun,
  runSiteVisitPruneNow,
  shouldPruneNow,
  type SiteVisitPruneSummary,
} from "./prune-runner";
export {
  SUSPICION_THRESHOLDS,
  describeSignal,
  describeSuspicion,
  levelFromSignals,
  scoreSuspicion,
} from "./suspicion";
export {
  formatDayLabel,
  formatWeekLabel,
  groupVisitsByWeekAndDay,
} from "./grouping";
export {
  DEFAULT_RETENTION_DAYS,
  allowIpAddress,
  deleteSiteVisits,
  disallowIpAddress,
  getSiteVisitSummary,
  hasUnreviewedSuspiciousVisits,
  listAllowedIps,
  listSiteVisits,
  listVisitsByWeek,
  markSuspiciousReviewed,
  pruneSiteVisits,
  recordSiteVisit,
  toSqliteTimestamp,
} from "./site-visits";
