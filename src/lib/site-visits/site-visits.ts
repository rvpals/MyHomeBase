import type { IpAllowlistRepository, SiteVisitRepository } from "./ports";
import {
  bulkIdsSchema,
  newIpAllowlistEntrySchema,
  newSiteVisitSchema,
  retentionDaysSchema,
  siteVisitFilterSchema,
} from "./schema";
import { SUSPICION_THRESHOLDS, scoreSuspicion } from "./suspicion";
import type {
  IpAllowlistEntry,
  NewIpAllowlistEntry,
  SiteVisit,
  SiteVisitContext,
  SiteVisitFilter,
  SiteVisitSummary,
  VisitWeekGroup,
} from "./types";
import { groupVisitsByWeekAndDay } from "./grouping";

/** Matches the auth log, so both halves of the Security screen age out together. */
export const DEFAULT_RETENTION_DAYS = 90;

/**
 * Converts a `Date` to SQLite's `datetime('now')` format — `YYYY-MM-DD HH:MM:SS` in
 * UTC. Kept identical to the auth log's helper so the two tables sort against each
 * other without conversion.
 */
export function toSqliteTimestamp(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Records one logged-out arrival at the site root, scoring it on the way in.
 *
 * **Never throws.** This runs inside the layout render for a logged-out visitor, a
 * hair before the redirect to the sign-in page. A failed audit write must not turn
 * somebody's arrival into an error page — the visit is the thing being observed, not
 * a transaction being protected. Invalid input, a scoring error, and a database
 * failure all end the same way: nothing is written and the caller carries on.
 *
 * That silence is deliberate but one-directional: it hides *infrastructure* failure,
 * never a visit. A row that can be written is always written, including for
 * allowlisted addresses (migrations/0103) — vouching changes the verdict, never
 * whether the evidence exists.
 */
export function recordSiteVisit(
  context: SiteVisitContext,
  visitRepo: SiteVisitRepository,
  allowlistRepo: IpAllowlistRepository,
): void {
  try {
    const parsed = newSiteVisitSchema.safeParse(context);
    if (!parsed.success) return;

    const ipAddress = parsed.data.ipAddress;

    // An unknown address gets no history and no allowlist hit: there is nothing to
    // correlate it with, so it is scored on the request alone.
    const history = ipAddress
      ? {
          allowlisted: allowlistRepo.isAllowed(ipAddress),
          ...visitRepo.getIpHistory(ipAddress, SUSPICION_THRESHOLDS.burstWindowMinutes),
        }
      : {
          allowlisted: false,
          recentVisits: 0,
          totalVisits: 0,
          authAttempts: 0,
          authFailures: 0,
        };

    // Both halves of the score are kept. Until migrations/0106 only `level` was
    // written and the reasons were dropped here, which left the Visit tab showing a
    // red badge with no way to tell a scanner from a failed password.
    const { level, signals } = scoreSuspicion(parsed.data, history);

    visitRepo.recordVisit({ ...parsed.data, suspicion: level, signals });
  } catch {
    // Swallowed on purpose — see the doc comment. There is nowhere useful to report
    // this to: the visitor must not see it, and throwing would break their redirect.
  }
}

/** Arrivals, newest first. Validates the filter at the boundary. */
export function listSiteVisits(
  filter: SiteVisitFilter,
  repo: SiteVisitRepository,
): SiteVisit[] {
  return repo.listVisits(siteVisitFilterSchema.parse(filter));
}

/** Arrivals grouped for the Visit tab: weeks outermost, days inside, newest first. */
export function listVisitsByWeek(
  filter: SiteVisitFilter,
  repo: SiteVisitRepository,
): VisitWeekGroup[] {
  return groupVisitsByWeekAndDay(listSiteVisits(filter, repo));
}

/** The headline numbers above the tree. */
export function getSiteVisitSummary(repo: SiteVisitRepository): SiteVisitSummary {
  return repo.getSummary();
}

/** Drives the home-screen alert. Suspicious only — `watch` never raises a banner. */
export function hasUnreviewedSuspiciousVisits(repo: SiteVisitRepository): boolean {
  return repo.getSummary().unreviewedSuspicious > 0;
}

/**
 * Acknowledges every suspicious visit that exists right now.
 *
 * Bounded to this instant, exactly as the auth log's equivalent is: a visit arriving
 * while the admin is reading the screen stays unreviewed rather than being cleared
 * unseen.
 */
export function markSuspiciousReviewed(
  repo: SiteVisitRepository,
  now: Date = new Date(),
): void {
  const stamp = toSqliteTimestamp(now);
  repo.markSuspiciousReviewed(stamp, stamp);
}

/**
 * Deletes the given arrivals. Admin-initiated, and distinct from the prune.
 *
 * Unlike `recordSiteVisit` this *does* throw on invalid input: a delete is a
 * deliberate act by an admin looking at a screen, so "you selected nothing" has to
 * reach them rather than being swallowed as a silent success.
 */
export function deleteSiteVisits(ids: number[], repo: SiteVisitRepository): number {
  return repo.deleteVisits(bulkIdsSchema.parse(ids));
}

/** Deletes arrivals older than `retentionDays`. Returns how many went. */
export function pruneSiteVisits(
  repo: SiteVisitRepository,
  retentionDays: number = DEFAULT_RETENTION_DAYS,
  now: Date = new Date(),
): number {
  const days = retentionDaysSchema.parse(retentionDays);
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return repo.deleteVisitsBefore(toSqliteTimestamp(cutoff));
}

/**
 * Vouches for an address, and re-scores every visit it has already made.
 *
 * The re-score is the half that is easy to forget and obvious when missing: without
 * it the reader allowlists their own phone and watches yesterday's red rows sit there
 * unchanged, which reads as the feature not working. Marked reviewed at the same
 * time, because vouching for an address *is* the review.
 *
 * Returns how many past visits were re-scored. Already-listed addresses are a no-op
 * on the table and still re-score, so pressing the button twice is harmless.
 */
export function allowIpAddress(
  entry: NewIpAllowlistEntry,
  allowlistRepo: IpAllowlistRepository,
  visitRepo: SiteVisitRepository,
  now: Date = new Date(),
): number {
  const parsed = newIpAllowlistEntrySchema.parse(entry);
  allowlistRepo.add(parsed);
  // Reasons are cleared along with the verdict: a grey "Normal" row listing why it
  // was once suspicious invites exactly the second-guessing vouching exists to end.
  // This matches `scoreSuspicion`, which returns no signals for an allowlisted visit.
  return visitRepo.setSuspicionForIp(parsed.ipAddress, "normal", [], toSqliteTimestamp(now));
}

/** Every vouched-for address, newest first. */
export function listAllowedIps(repo: IpAllowlistRepository): IpAllowlistEntry[] {
  return repo.list();
}

/**
 * Stops vouching for an address, and re-scores its visits against the live rules.
 *
 * Re-scoring on the way out matters as much as on the way in: an entry removed
 * because the address turned out not to be trusted must stop hiding that address's
 * past behaviour. Rows are re-scored with the *request-shaped* signals only — the
 * stored row has no history attached — which can leave them milder than a fresh
 * score would be. That is an accepted limit of re-deriving a verdict after the fact;
 * the rows are visible either way.
 *
 * Returns how many past visits were re-scored, or 0 if the id was not there.
 */
export function disallowIpAddress(
  id: number,
  ipAddress: string,
  allowlistRepo: IpAllowlistRepository,
  visitRepo: SiteVisitRepository,
): number {
  if (!allowlistRepo.remove(id)) return 0;

  // Re-scored from the address's own record rather than left as-is. `watch` rather
  // than `normal` or `suspicious`: the reader deliberately un-trusted this address,
  // so it should resurface, but the stored rows cannot re-run the full scorer.
  //
  // `allowlist_removed` is the reason, and it is the honest one: it records what
  // actually caused the re-flag — an admin decision — rather than inventing a
  // heuristic finding the scorer never made. Without it the amber badge would sit
  // there with an empty Why column, which reads like a bug (migrations/0106).
  return visitRepo.setSuspicionForIp(ipAddress, "watch", ["allowlist_removed"]);
}
