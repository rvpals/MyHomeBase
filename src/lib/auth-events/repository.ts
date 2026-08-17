import type Database from "better-sqlite3";
import type { AuthEventRepository } from "./ports";
import { authEventSchema } from "./schema";
import type {
  AuthEvent,
  AuthEventFilter,
  AuthEventSummary,
  AuthEventType,
  NewAuthEvent,
} from "./types";

interface AuthEventRow {
  id: number;
  event_type: string;
  attempted_username: string;
  user_id: number | null;
  failure_reason: string;
  ip_address: string;
  user_agent: string;
  reviewed_at: string | null;
  created_at: string;
}

/** The table stores blank for "absent" (migrations/0045); the domain uses `undefined`. */
function blankToUndefined(value: string): string | undefined {
  return value === "" ? undefined : value;
}

function toDomain(row: AuthEventRow): AuthEvent {
  return authEventSchema.parse({
    id: row.id,
    eventType: row.event_type,
    attemptedUsername: blankToUndefined(row.attempted_username),
    userId: row.user_id ?? undefined,
    failureReason: blankToUndefined(row.failure_reason),
    ipAddress: blankToUndefined(row.ip_address),
    userAgent: blankToUndefined(row.user_agent),
    reviewedAt: row.reviewed_at ?? undefined,
    createdAt: row.created_at,
  });
}

// The real repository. Swap the database without touching any use-case.
export class SqliteAuthEventRepository implements AuthEventRepository {
  constructor(private db: Database.Database) {}

  recordEvent(event: NewAuthEvent): void {
    this.db
      .prepare(
        `INSERT INTO sys_auth_events
           (event_type, attempted_username, user_id, failure_reason, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.eventType,
        event.attemptedUsername ?? "",
        event.userId ?? null,
        event.failureReason ?? "",
        event.ipAddress ?? "",
        event.userAgent ?? "",
      );
  }

  listEvents(filter: AuthEventFilter): AuthEvent[] {
    // Built up rather than one fixed statement because every filter is optional;
    // values stay bound, never interpolated.
    const conditions: string[] = [];
    const values: (string | number)[] = [];

    if (filter.eventType) {
      conditions.push("event_type = ?");
      values.push(filter.eventType);
    }
    if (filter.username) {
      conditions.push("attempted_username LIKE ? ESCAPE '\\'");
      // Escape the LIKE wildcards so a username containing % or _ matches literally.
      values.push(`%${filter.username.replace(/[\\%_]/g, "\\$&")}%`);
    }
    if (filter.since) {
      conditions.push("created_at >= ?");
      values.push(filter.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter.limit ?? 200;

    const rows = this.db
      .prepare(
        `SELECT id, event_type, attempted_username, user_id, failure_reason,
                ip_address, user_agent, reviewed_at, created_at
         FROM sys_auth_events
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(...values, limit) as AuthEventRow[];

    return rows.map(toDomain);
  }

  getSummary(): AuthEventSummary {
    const row = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN event_type = 'login_failure' THEN 1 ELSE 0 END) AS total_failures,
           SUM(CASE WHEN event_type = 'login_failure' AND reviewed_at IS NULL THEN 1 ELSE 0 END) AS unreviewed_failures,
           SUM(CASE WHEN event_type = 'login_success' THEN 1 ELSE 0 END) AS total_successes,
           MAX(CASE WHEN event_type = 'login_failure' AND reviewed_at IS NULL THEN created_at END) AS latest_failure_at
         FROM sys_auth_events`,
      )
      .get() as {
      total_failures: number | null;
      unreviewed_failures: number | null;
      total_successes: number | null;
      latest_failure_at: string | null;
    };

    // SUM over zero rows is NULL, not 0.
    return {
      totalFailures: row.total_failures ?? 0,
      unreviewedFailures: row.unreviewed_failures ?? 0,
      totalSuccesses: row.total_successes ?? 0,
      latestFailureAt: row.latest_failure_at ?? undefined,
    };
  }

  markFailuresReviewed(asOf: string, reviewedAt: string): void {
    this.db
      .prepare(
        `UPDATE sys_auth_events
         SET reviewed_at = ?
         WHERE event_type = 'login_failure' AND reviewed_at IS NULL AND created_at <= ?`,
      )
      .run(reviewedAt, asOf);
  }

  deleteEventsBefore(cutoff: string): number {
    const result = this.db
      .prepare("DELETE FROM sys_auth_events WHERE created_at < ?")
      .run(cutoff);
    return result.changes;
  }
}

/** Event types, exported for the admin screen's filter dropdown. */
export const AUTH_EVENT_TYPES: AuthEventType[] = ["login_success", "login_failure", "logout"];
