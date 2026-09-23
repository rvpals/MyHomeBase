import type Database from "better-sqlite3";
import type { IpAllowlistRepository, SiteVisitRepository } from "./ports";
import { ipAllowlistEntrySchema, siteVisitSchema } from "./schema";
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

interface SiteVisitRow {
  id: number;
  ip_address: string;
  user_agent: string;
  referer: string;
  path: string;
  suspicion: string;
  reviewed_at: string | null;
  created_at: string;
}

interface AllowlistRow {
  id: number;
  ip_address: string;
  label: string;
  added_by_user_id: number | null;
  created_at: string;
}

/** The table stores blank for "absent" (migrations/0102); the domain uses `undefined`. */
function blankToUndefined(value: string): string | undefined {
  return value === "" ? undefined : value;
}

function toDomain(row: SiteVisitRow): SiteVisit {
  return siteVisitSchema.parse({
    id: row.id,
    ipAddress: blankToUndefined(row.ip_address),
    userAgent: blankToUndefined(row.user_agent),
    referer: blankToUndefined(row.referer),
    path: row.path,
    suspicion: row.suspicion,
    reviewedAt: row.reviewed_at ?? undefined,
    createdAt: row.created_at,
  });
}

function toAllowlistDomain(row: AllowlistRow): IpAllowlistEntry {
  return ipAllowlistEntrySchema.parse({
    id: row.id,
    ipAddress: row.ip_address,
    label: blankToUndefined(row.label),
    addedByUserId: row.added_by_user_id ?? undefined,
    createdAt: row.created_at,
  });
}

// The real repository. Swap the database without touching any use-case.
export class SqliteSiteVisitRepository implements SiteVisitRepository {
  constructor(private db: Database.Database) {}

  recordVisit(visit: NewSiteVisit): void {
    this.db
      .prepare(
        `INSERT INTO sys_site_visits
           (ip_address, user_agent, referer, path, suspicion)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        visit.ipAddress ?? "",
        visit.userAgent ?? "",
        visit.referer ?? "",
        visit.path ?? "/",
        visit.suspicion ?? "normal",
      );
  }

  listVisits(filter: SiteVisitFilter): SiteVisit[] {
    // Built up rather than one fixed statement because every filter is optional;
    // values stay bound, never interpolated.
    const conditions: string[] = [];
    const values: (string | number)[] = [];

    if (filter.suspicion) {
      conditions.push("suspicion = ?");
      values.push(filter.suspicion);
    }
    if (filter.ipAddress) {
      conditions.push("ip_address = ?");
      values.push(filter.ipAddress);
    }
    if (filter.since) {
      conditions.push("created_at >= ?");
      values.push(filter.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 1000;

    const rows = this.db
      .prepare(
        `SELECT id, ip_address, user_agent, referer, path, suspicion, reviewed_at, created_at
         FROM sys_site_visits
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(...values, limit) as SiteVisitRow[];

    return rows.map(toDomain);
  }

  getSummary(): SiteVisitSummary {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total_visits,
           COUNT(DISTINCT ip_address) AS unique_ips,
           SUM(CASE WHEN suspicion = 'suspicious' THEN 1 ELSE 0 END) AS suspicious_visits,
           SUM(CASE WHEN suspicion = 'suspicious' AND reviewed_at IS NULL THEN 1 ELSE 0 END) AS unreviewed_suspicious,
           MAX(CASE WHEN suspicion = 'suspicious' AND reviewed_at IS NULL THEN created_at END) AS latest_suspicious_at
         FROM sys_site_visits`,
      )
      .get() as {
      total_visits: number | null;
      unique_ips: number | null;
      suspicious_visits: number | null;
      unreviewed_suspicious: number | null;
      latest_suspicious_at: string | null;
    };

    // SUM over zero rows is NULL, not 0.
    return {
      totalVisits: row.total_visits ?? 0,
      uniqueIps: row.unique_ips ?? 0,
      suspiciousVisits: row.suspicious_visits ?? 0,
      unreviewedSuspicious: row.unreviewed_suspicious ?? 0,
      latestSuspiciousAt: row.latest_suspicious_at ?? undefined,
    };
  }

  /**
   * What is known about one address, in two reads.
   *
   * The auth half deliberately crosses into `sys_auth_events` — that correlation is
   * the strongest signal the scorer has, and it can only be made here where both
   * tables are reachable. The use-case stays ignorant of SQL, receiving plain counts.
   *
   * `recentVisits` uses SQLite's own `datetime('now', ?)` rather than a timestamp
   * computed in JS, so the window is measured on the same clock that wrote
   * `created_at`. Mixing the two would make the burst window drift by whatever the
   * process's clock skew happens to be.
   */
  getIpHistory(
    ipAddress: string,
    burstWindowMinutes: number,
  ): Omit<IpHistory, "allowlisted"> {
    const visits = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total_visits,
           SUM(CASE WHEN created_at >= datetime('now', ?) THEN 1 ELSE 0 END) AS recent_visits
         FROM sys_site_visits
         WHERE ip_address = ?`,
      )
      .get(`-${burstWindowMinutes} minutes`, ipAddress) as {
      total_visits: number | null;
      recent_visits: number | null;
    };

    const auth = this.db
      .prepare(
        `SELECT
           COUNT(*) AS attempts,
           SUM(CASE WHEN event_type = 'login_failure' THEN 1 ELSE 0 END) AS failures
         FROM sys_auth_events
         WHERE ip_address = ?`,
      )
      .get(ipAddress) as { attempts: number | null; failures: number | null };

    return {
      recentVisits: visits.recent_visits ?? 0,
      totalVisits: visits.total_visits ?? 0,
      authAttempts: auth.attempts ?? 0,
      authFailures: auth.failures ?? 0,
    };
  }

  markSuspiciousReviewed(asOf: string, reviewedAt: string): void {
    this.db
      .prepare(
        `UPDATE sys_site_visits
         SET reviewed_at = ?
         WHERE suspicion = 'suspicious' AND reviewed_at IS NULL AND created_at <= ?`,
      )
      .run(reviewedAt, asOf);
  }

  setSuspicionForIp(ipAddress: string, level: SuspicionLevel, reviewedAt?: string): number {
    // COALESCE keeps an existing acknowledgement rather than overwriting it: a row
    // reviewed last week stays reviewed, and only unreviewed rows take the new stamp.
    const result =
      reviewedAt === undefined
        ? this.db
            .prepare("UPDATE sys_site_visits SET suspicion = ? WHERE ip_address = ?")
            .run(level, ipAddress)
        : this.db
            .prepare(
              `UPDATE sys_site_visits
               SET suspicion = ?, reviewed_at = COALESCE(reviewed_at, ?)
               WHERE ip_address = ?`,
            )
            .run(level, reviewedAt, ipAddress);

    return result.changes;
  }

  deleteVisits(ids: number[]): number {
    if (ids.length === 0) return 0;

    // Placeholders generated from the array length, values still bound — the ids are
    // numbers validated by `bulkIdsSchema`, and none of them reach the SQL as text.
    const placeholders = ids.map(() => "?").join(", ");
    const result = this.db
      .prepare(`DELETE FROM sys_site_visits WHERE id IN (${placeholders})`)
      .run(...ids);
    return result.changes;
  }

  deleteVisitsBefore(cutoff: string): number {
    const result = this.db.prepare("DELETE FROM sys_site_visits WHERE created_at < ?").run(cutoff);
    return result.changes;
  }
}

export class SqliteIpAllowlistRepository implements IpAllowlistRepository {
  constructor(private db: Database.Database) {}

  add(entry: NewIpAllowlistEntry): boolean {
    // OR IGNORE against the UNIQUE index (migrations/0103), which is what makes this
    // idempotent: the bulk action ticks rows that often share an address, so asking
    // twice has to be a no-op rather than an error.
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO sys_ip_allowlist (ip_address, label, added_by_user_id)
         VALUES (?, ?, ?)`,
      )
      .run(entry.ipAddress, entry.label ?? "", entry.addedByUserId ?? null);

    return result.changes > 0;
  }

  list(): IpAllowlistEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, ip_address, label, added_by_user_id, created_at
         FROM sys_ip_allowlist
         ORDER BY created_at DESC, id DESC`,
      )
      .all() as AllowlistRow[];

    return rows.map(toAllowlistDomain);
  }

  isAllowed(ipAddress: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS hit FROM sys_ip_allowlist WHERE ip_address = ? LIMIT 1")
      .get(ipAddress) as { hit: number } | undefined;

    return row !== undefined;
  }

  remove(id: number): boolean {
    const result = this.db.prepare("DELETE FROM sys_ip_allowlist WHERE id = ?").run(id);
    return result.changes > 0;
  }
}
