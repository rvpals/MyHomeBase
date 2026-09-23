/**
 * How worried to be about one arrival.
 *
 * Three levels, not two, because most odd-looking visits are harmless. `watch` is
 * where a single weak signal lands — an unfamiliar user agent and nothing else — so
 * that `suspicious` keeps meaning something. A flag that fires on everything trains
 * the reader to ignore the column, which is the failure this scale is shaped against.
 *
 * Scored at write time and stored (migrations/0102), so a verdict can go stale when
 * the rules change or an allowlist entry is added. Both paths re-score explicitly.
 */
export type SuspicionLevel = "normal" | "watch" | "suspicious";

/**
 * Why a visit was flagged. Each is one signal; a verdict is the sum of them, so a
 * single row can carry several.
 *
 * These are *reasons shown to the reader*, not a taxonomy anything branches on — the
 * scorer produces them for display and the screen prints them. Adding one is a
 * display change, not a behaviour change.
 */
export type SuspicionSignal =
  /** No user agent at all. Browsers always send one; scripts frequently don't. */
  | "no_user_agent"
  /** The user agent names a scripting tool — curl, wget, python-requests, Go-http-client. */
  | "tool_user_agent"
  /** The user agent names a known crawler or scanner. */
  | "scanner_user_agent"
  /** Many arrivals from this address in a short window. */
  | "burst"
  /** This address has arrived repeatedly and never once reached the sign-in form. */
  | "never_signs_in"
  /** This address also appears in the failed-sign-in log. The serious one. */
  | "auth_failures";

/**
 * Request metadata the presentation layer gathers and passes in as plain data.
 *
 * Mirrors `AuthEventContext` and exists separately because this one carries `referer`
 * and `path`, which the auth log has no use for. Gathered in `src/app` because
 * `next/headers` is banned under `src/lib` (ARCHITECTURE.md).
 */
export interface SiteVisitContext {
  /** First `x-forwarded-for` hop. Advisory only — behind a reverse proxy it is whatever the proxy claims. */
  ipAddress?: string;
  userAgent?: string;
  /** Blank when the URL was typed or opened from a bookmark, which is the common case. */
  referer?: string;
  /** Only `/` is written today. Stored so widening the hook later needs no migration. */
  path?: string;
}

export interface SiteVisit {
  id: number;
  ipAddress?: string;
  userAgent?: string;
  referer?: string;
  path: string;
  suspicion: SuspicionLevel;
  /** When an admin acknowledged this visit. `undefined` while unreviewed. */
  reviewedAt?: string;
  createdAt: string;
}

/** A row to write. Shaped like the use-case's input, not like the table. */
export interface NewSiteVisit {
  ipAddress?: string;
  userAgent?: string;
  referer?: string;
  path?: string;
  suspicion?: SuspicionLevel;
}

/** Filters for the Visit tab. Every field is optional — omitted means "no filter". */
export interface SiteVisitFilter {
  suspicion?: SuspicionLevel;
  /** Exact match. Used by the allowlist re-score, not by the screen. */
  ipAddress?: string;
  /** Inclusive ISO date (`YYYY-MM-DD`) lower bound on `createdAt`. */
  since?: string;
  limit?: number;
}

/** The headline numbers above the week/day tree. */
export interface SiteVisitSummary {
  totalVisits: number;
  uniqueIps: number;
  suspiciousVisits: number;
  unreviewedSuspicious: number;
  /** Newest unreviewed suspicious visit, for the home-screen alert wording. */
  latestSuspiciousAt?: string;
}

/**
 * What the scorer needs to know about an address beyond the request itself.
 *
 * Passed in rather than queried, so `scoreSuspicion` stays a pure function of its
 * arguments and the tests can construct any history in one object literal.
 */
export interface IpHistory {
  /** Is this address on the allowlist? Short-circuits every other signal. */
  allowlisted: boolean;
  /** Arrivals from this address inside the burst window, not counting this one. */
  recentVisits: number;
  /** Arrivals from this address over the whole retention period. */
  totalVisits: number;
  /** Times this address reached the sign-in form and typed something. */
  authAttempts: number;
  /** Times this address failed a sign-in. */
  authFailures: number;
}

/** One visit, with the reasons it was scored the way it was. For the screen. */
export interface ScoredVisit {
  level: SuspicionLevel;
  signals: SuspicionSignal[];
}

/** One day's arrivals, the inner level of the week/day tree. */
export interface VisitDayGroup {
  /** `YYYY-MM-DD`, local. */
  date: string;
  /** "Sat Sep 19" — built in the lib so the view has no date logic in it. */
  label: string;
  visits: SiteVisit[];
  totalVisits: number;
  uniqueIps: number;
  suspiciousVisits: number;
}

/** One week's arrivals, the outer level of the week/day tree. */
export interface VisitWeekGroup {
  /** ISO week-numbering year and week, e.g. 2026 and 38. */
  isoYear: number;
  isoWeek: number;
  /** `YYYY-MM-DD` of the Monday. Sorts correctly and keys the React list. */
  weekStart: string;
  /** "Week 38 · Sep 14–20" — built in the lib, for the same reason `day.label` is. */
  label: string;
  days: VisitDayGroup[];
  totalVisits: number;
  uniqueIps: number;
  suspiciousVisits: number;
}

/** An address the reader has vouched for. */
export interface IpAllowlistEntry {
  id: number;
  ipAddress: string;
  /** Why it is trusted, in the reader's words. `undefined` when they didn't say. */
  label?: string;
  addedByUserId?: number;
  createdAt: string;
}

/** An address to vouch for. */
export interface NewIpAllowlistEntry {
  ipAddress: string;
  label?: string;
  addedByUserId?: number;
}
