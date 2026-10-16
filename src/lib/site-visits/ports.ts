import type {
  IpAllowlistEntry,
  IpBlacklistEntry,
  IpHistory,
  NewIpAllowlistEntry,
  NewIpBlacklistEntry,
  NewSiteVisit,
  SiteVisit,
  SiteVisitFilter,
  SiteVisitSummary,
  SuspicionLevel,
  SuspicionSignal,
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
   * What the scorer needs to know about an address, minus the two lists — those are
   * the allowlist and blacklist repositories' business, and `scoreSuspicion` receives
   * all three merged. `burstWindowMinutes` bounds the `recentVisits` count.
   */
  getIpHistory(
    ipAddress: string,
    burstWindowMinutes: number,
  ): Omit<IpHistory, "allowlisted" | "blacklisted">;
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
   *
   * `signals` replaces the stored reasons wholesale rather than merging: the rows are
   * being given a new verdict, and reasons for the old one would contradict it.
   * Passing `[]` clears them, which is what vouching for an address does
   * (migrations/0106).
   */
  setSuspicionForIp(
    ipAddress: string,
    level: SuspicionLevel,
    signals: readonly SuspicionSignal[],
    reviewedAt?: string,
  ): number;
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
  /**
   * Removes the entry for an address, whatever its id. Returns whether a row went.
   *
   * Exists so `blockIpAddress` can clear a contradicting entry without first looking
   * the id up — the two lists are kept mutually exclusive by the use-cases
   * (migrations/0144), and that enforcement reads better as one call than as a
   * list-scan-then-remove.
   */
  removeByAddress(ipAddress: string): boolean;
}

export interface IpBlacklistRepository {
  /**
   * Adds an address if it is not already there, and returns whether a row was
   * created. Idempotent for the same reason the allowlist's `add` is: the bulk
   * action ticks rows that often share an address.
   */
  add(entry: NewIpBlacklistEntry): boolean;
  /** Every distrusted address, newest first. Expected to be a handful of rows. */
  list(): IpBlacklistEntry[];
  /**
   * Is this address distrusted? Read on every visit write, before the insert.
   *
   * NOT an authorisation check, and no caller may use it as one (migrations/0144):
   * the address comes from a forgeable header, so this only ever decides a colour.
   * A blacklist is the shape of thing somebody will be tempted to gate a request on
   * — don't. That belongs in the reverse proxy, where the connection is real.
   */
  isBlocked(ipAddress: string): boolean;
  /** Removes one entry by id. Returns whether a row went. */
  remove(id: number): boolean;
  /** Removes the entry for an address. The mirror of the allowlist's, same reason. */
  removeByAddress(ipAddress: string): boolean;
}
