import type {
  IpAllowlistEntry,
  IpHistory,
  NewIpAllowlistEntry,
  NewSiteVisit,
  SiteVisit,
  SiteVisitFilter,
  SiteVisitSummary,
  SuspicionLevel,
} from "./types";

// The use-cases depend on THESE interfaces, not on a concrete database.
// That is what lets the web app, the CLI, and tests each supply their own.

export interface SiteVisitRepository {
  /**
   * Appends one arrival. Never throws for a bad value — the caller is a page render
   * for a logged-out visitor, and a broken audit write must not turn the sign-in
   * redirect into an error page. Validation happens in the use-case, before this.
   */
  recordVisit(visit: NewSiteVisit): void;
  /** Newest first, bounded by `filter.limit`. */
  listVisits(filter: SiteVisitFilter): SiteVisit[];
  /** Counts for the tab header, in one round trip. */
  getSummary(): SiteVisitSummary;
  /**
   * What the scorer needs to know about an address, minus the allowlist — that is
   * the allowlist repository's business, and `scoreSuspicion` receives the two
   * merged. `burstWindowMinutes` bounds the `recentVisits` count.
   */
  getIpHistory(ipAddress: string, burstWindowMinutes: number): Omit<IpHistory, "allowlisted">;
  /**
   * Stamps `reviewed_at` on every unreviewed suspicious visit up to and including
   * `asOf`. Bounded by a timestamp rather than "all", so a visit arriving while an
   * admin is reading the screen is not silently marked reviewed.
   */
  markSuspiciousReviewed(asOf: string, reviewedAt: string): void;
  /**
   * Re-scores every visit from one address. Used when that address is added to or
   * removed from the allowlist, so a stored verdict never silently disagrees with
   * the rules. `reviewedAt` is stamped alongside when the new level is `normal`.
   */
  setSuspicionForIp(ipAddress: string, level: SuspicionLevel, reviewedAt?: string): number;
  /** Deletes the given rows. Returns how many went. Admin-initiated, not the prune. */
  deleteVisits(ids: number[]): number;
  /** Deletes visits created before `cutoff` (ISO). Returns how many went. */
  deleteVisitsBefore(cutoff: string): number;
}

export interface IpAllowlistRepository {
  /**
   * Adds an address if it is not already there, and returns whether a row was
   * created. Idempotent by design: the bulk action ticks rows that often share an
   * address, and asking twice must not fail.
   */
  add(entry: NewIpAllowlistEntry): boolean;
  /** Every vouched-for address, newest first. Expected to be a handful of rows. */
  list(): IpAllowlistEntry[];
  /**
   * Is this address vouched for? Read on every visit write, before the insert.
   *
   * NOT an authorisation check, and no caller may use it as one (migrations/0103):
   * the address comes from a forgeable header, so this only ever decides a colour.
   */
  isAllowed(ipAddress: string): boolean;
  /** Removes one entry by id. Returns whether a row went. */
  remove(id: number): boolean;
}
