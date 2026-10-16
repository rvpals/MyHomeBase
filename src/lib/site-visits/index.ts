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
  IpBlacklistEntry,
  IpHistory,
  NewIpAllowlistEntry,
  NewIpBlacklistEntry,
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
  ipBlacklistEntrySchema,
  newIpAllowlistEntrySchema,
  newIpBlacklistEntrySchema,
  newSiteVisitSchema,
  retentionDaysSchema,
  siteVisitFilterSchema,
  siteVisitSchema,
  suspicionSignalSchema,
  type NewIpAllowlistEntryInput,
  type NewIpBlacklistEntryInput,
  type NewSiteVisitInput,
  type SiteVisitFilterInput,
} from "./schema";
export type {
  IpAllowlistRepository,
  IpBlacklistRepository,
  SiteVisitRepository,
} from "./ports";
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
  decodeSignals,
  describeSignal,
  describeSuspicion,
  encodeSignals,
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
  blockIpAddress,
  deleteSiteVisits,
  disallowIpAddress,
  getSiteVisitSummary,
  hasUnreviewedSuspiciousVisits,
  listAllowedIps,
  listBlockedIps,
  listSiteVisits,
  listVisitsByWeek,
  markSuspiciousReviewed,
  pruneSiteVisits,
  recordSiteVisit,
  toSqliteTimestamp,
  unblockIpAddress,
} from "./site-visits";
