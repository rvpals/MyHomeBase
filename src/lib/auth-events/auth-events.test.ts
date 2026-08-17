import { describe, expect, it, vi } from "vitest";
import {
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
import type { AuthEventRepository } from "./ports";
import { MAX_ATTEMPTED_USERNAME_LENGTH } from "./schema";
import type { AuthEvent, AuthEventFilter, AuthEventSummary, NewAuthEvent } from "./types";

// Hand-written in-memory fake, per ARCHITECTURE.md — no mocking framework.
// Stores the domain shape the real repository would read back, and compares
// timestamps as strings exactly like SQLite does.
class FakeAuthEventRepository implements AuthEventRepository {
  rows: AuthEvent[] = [];
  private nextId = 1;

  /** Set to make the next write throw, proving the recorder swallows it. */
  failOnWrite = false;

  recordEvent(event: NewAuthEvent): void {
    if (this.failOnWrite) throw new Error("disk is on fire");
    this.rows.push({
      id: this.nextId++,
      ...event,
      createdAt: this.clock ?? "2026-08-16 12:00:00",
    });
  }

  /** Test-only: pin `created_at` for the next write. */
  clock?: string;

  listEvents(filter: AuthEventFilter): AuthEvent[] {
    let rows = [...this.rows].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) || right.id - left.id,
    );
    if (filter.eventType) rows = rows.filter((row) => row.eventType === filter.eventType);
    if (filter.username) {
      const needle = filter.username.toLowerCase();
      rows = rows.filter((row) => (row.attemptedUsername ?? "").toLowerCase().includes(needle));
    }
    if (filter.since) rows = rows.filter((row) => row.createdAt >= filter.since!);
    return rows.slice(0, filter.limit ?? 200);
  }

  getSummary(): AuthEventSummary {
    const failures = this.rows.filter((row) => row.eventType === "login_failure");
    const unreviewed = failures.filter((row) => row.reviewedAt === undefined);
    return {
      totalFailures: failures.length,
      unreviewedFailures: unreviewed.length,
      totalSuccesses: this.rows.filter((row) => row.eventType === "login_success").length,
      latestFailureAt: unreviewed
        .map((row) => row.createdAt)
        .sort()
        .at(-1),
    };
  }

  markFailuresReviewed(asOf: string, reviewedAt: string): void {
    for (const row of this.rows) {
      if (row.eventType === "login_failure" && !row.reviewedAt && row.createdAt <= asOf) {
        row.reviewedAt = reviewedAt;
      }
    }
  }

  deleteEventsBefore(cutoff: string): number {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => row.createdAt >= cutoff);
    return before - this.rows.length;
  }
}

const CONTEXT = { ipAddress: "192.168.1.20", userAgent: "Mozilla/5.0" };

describe("recordAuthEvent", () => {
  it("records a failure with its reason and the request metadata", () => {
    const repo = new FakeAuthEventRepository();

    recordLoginFailure("minliang", "bad_password", CONTEXT, repo, 7);

    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]).toMatchObject({
      eventType: "login_failure",
      attemptedUsername: "minliang",
      failureReason: "bad_password",
      userId: 7,
      ipAddress: "192.168.1.20",
      userAgent: "Mozilla/5.0",
    });
  });

  it("records a success with the resolved user and no failure reason", () => {
    const repo = new FakeAuthEventRepository();

    recordLoginSuccess("minliang", 7, CONTEXT, repo);

    expect(repo.rows[0].eventType).toBe("login_success");
    expect(repo.rows[0].userId).toBe(7);
    expect(repo.rows[0].failureReason).toBeUndefined();
  });

  it("records a logout, which carries no attempted username", () => {
    const repo = new FakeAuthEventRepository();

    recordLogout(7, CONTEXT, repo);

    expect(repo.rows[0]).toMatchObject({ eventType: "logout", userId: 7 });
    expect(repo.rows[0].attemptedUsername).toBeUndefined();
  });

  it("leaves an unknown username unresolved rather than inventing a user id", () => {
    const repo = new FakeAuthEventRepository();

    recordLoginFailure("nobody", "unknown_user", CONTEXT, repo);

    expect(repo.rows[0].userId).toBeUndefined();
    expect(repo.rows[0].attemptedUsername).toBe("nobody");
  });

  // The whole point of the try/catch in recordAuthEvent: a broken audit write must
  // not turn a valid sign-in into a failed one.
  it("swallows a repository failure so logging can never break a login", () => {
    const repo = new FakeAuthEventRepository();
    repo.failOnWrite = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      recordLoginSuccess("minliang", 7, CONTEXT, repo),
    ).not.toThrow();
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("swallows an invalid event rather than throwing at the login boundary", () => {
    const repo = new FakeAuthEventRepository();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    // userId 0 fails the positive-int schema.
    recordAuthEvent({ eventType: "login_success", userId: 0 }, repo);

    expect(repo.rows).toHaveLength(0);
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("truncates an over-long typed username instead of rejecting the write", () => {
    const repo = new FakeAuthEventRepository();

    recordLoginFailure("x".repeat(500), "unknown_user", {}, repo);

    expect(repo.rows[0].attemptedUsername).toHaveLength(MAX_ATTEMPTED_USERNAME_LENGTH);
  });

  it("stores a blank username as absent, not as an empty string", () => {
    const repo = new FakeAuthEventRepository();

    recordLoginFailure("   ", "invalid_input", {}, repo);

    expect(repo.rows[0].attemptedUsername).toBeUndefined();
  });
});

describe("listAuthEvents", () => {
  function seeded(): FakeAuthEventRepository {
    const repo = new FakeAuthEventRepository();
    repo.clock = "2026-08-14 09:00:00";
    recordLoginSuccess("minliang", 1, {}, repo);
    repo.clock = "2026-08-15 10:00:00";
    recordLoginFailure("intruder", "unknown_user", {}, repo);
    repo.clock = "2026-08-16 11:00:00";
    recordLoginFailure("minliang", "bad_password", {}, repo, 1);
    return repo;
  }

  it("returns newest first", () => {
    const events = listAuthEvents({}, seeded());
    expect(events.map((event) => event.createdAt)).toEqual([
      "2026-08-16 11:00:00",
      "2026-08-15 10:00:00",
      "2026-08-14 09:00:00",
    ]);
  });

  it("filters by event type", () => {
    const events = listAuthEvents({ eventType: "login_failure" }, seeded());
    expect(events).toHaveLength(2);
  });

  it("filters by username substring", () => {
    const events = listAuthEvents({ username: "intr" }, seeded());
    expect(events).toHaveLength(1);
    expect(events[0].attemptedUsername).toBe("intruder");
  });

  it("applies a default limit so a caller can't read the whole table by omission", () => {
    const repo = new FakeAuthEventRepository();
    for (let index = 0; index < 300; index += 1) {
      recordLoginFailure(`user${index}`, "unknown_user", {}, repo);
    }
    expect(listAuthEvents({}, repo)).toHaveLength(200);
  });

  it("rejects a limit above the cap", () => {
    expect(() => listAuthEvents({ limit: 99999 }, seeded())).toThrow();
  });

  it("rejects a malformed since date", () => {
    expect(() => listAuthEvents({ since: "16-08-2026" }, seeded())).toThrow();
  });
});

describe("hasUnreviewedFailures / markFailuresReviewed", () => {
  it("is false when there are no events at all", () => {
    expect(hasUnreviewedFailures(new FakeAuthEventRepository())).toBe(false);
  });

  it("is false when only successes exist", () => {
    const repo = new FakeAuthEventRepository();
    recordLoginSuccess("minliang", 1, {}, repo);
    expect(hasUnreviewedFailures(repo)).toBe(false);
  });

  it("is true once a failure is recorded, and false after review", () => {
    const repo = new FakeAuthEventRepository();
    recordLoginFailure("intruder", "unknown_user", {}, repo);
    expect(hasUnreviewedFailures(repo)).toBe(true);

    markFailuresReviewed(repo, new Date("2026-08-17T00:00:00Z"));

    expect(hasUnreviewedFailures(repo)).toBe(false);
  });

  // Guards the "cleared unseen" bug: acknowledging what is on screen must not
  // acknowledge a failure that arrived while the admin was reading.
  it("leaves a failure newer than the acknowledged moment unreviewed", () => {
    const repo = new FakeAuthEventRepository();
    repo.clock = "2026-08-16 10:00:00";
    recordLoginFailure("old", "unknown_user", {}, repo);
    repo.clock = "2026-08-16 23:00:00";
    recordLoginFailure("new", "unknown_user", {}, repo);

    markFailuresReviewed(repo, new Date("2026-08-16T12:00:00Z"));

    expect(getAuthEventSummary(repo).unreviewedFailures).toBe(1);
    expect(repo.rows.find((row) => row.attemptedUsername === "new")?.reviewedAt).toBeUndefined();
  });
});

describe("getAuthEventSummary", () => {
  it("returns zeroes for an empty table rather than undefined counts", () => {
    expect(getAuthEventSummary(new FakeAuthEventRepository())).toEqual({
      totalFailures: 0,
      unreviewedFailures: 0,
      totalSuccesses: 0,
      latestFailureAt: undefined,
    });
  });

  it("counts successes and failures separately", () => {
    const repo = new FakeAuthEventRepository();
    recordLoginSuccess("minliang", 1, {}, repo);
    recordLoginFailure("a", "bad_password", {}, repo);
    recordLoginFailure("b", "unknown_user", {}, repo);

    const summary = getAuthEventSummary(repo);

    expect(summary.totalSuccesses).toBe(1);
    expect(summary.totalFailures).toBe(2);
    expect(summary.unreviewedFailures).toBe(2);
  });
});

describe("pruneAuthEvents", () => {
  it("deletes events older than the retention window and keeps the rest", () => {
    const repo = new FakeAuthEventRepository();
    repo.clock = "2026-01-01 00:00:00"; // well past 90 days
    recordLoginFailure("ancient", "unknown_user", {}, repo);
    repo.clock = "2026-08-15 00:00:00"; // yesterday
    recordLoginFailure("recent", "unknown_user", {}, repo);

    const deleted = pruneAuthEvents(repo, DEFAULT_RETENTION_DAYS, new Date("2026-08-16T12:00:00Z"));

    expect(deleted).toBe(1);
    expect(repo.rows.map((row) => row.attemptedUsername)).toEqual(["recent"]);
  });

  it("deletes nothing when everything is inside the window", () => {
    const repo = new FakeAuthEventRepository();
    repo.clock = "2026-08-16 00:00:00";
    recordLoginSuccess("minliang", 1, {}, repo);

    expect(pruneAuthEvents(repo, 90, new Date("2026-08-16T12:00:00Z"))).toBe(0);
  });

  it("rejects a retention of zero days, which would empty the table", () => {
    expect(() => pruneAuthEvents(new FakeAuthEventRepository(), 0)).toThrow();
  });
});

describe("toSqliteTimestamp", () => {
  // Regression guard: an ISO string sorts wrong against `datetime('now')` values
  // because "T" > " ", so a cutoff built with toISOString would match too much.
  it("matches SQLite's datetime('now') format, not toISOString", () => {
    const stamp = toSqliteTimestamp(new Date("2026-08-16T14:30:00.000Z"));
    expect(stamp).toBe("2026-08-16 14:30:00");
    expect(stamp).not.toContain("T");
  });

  it("sorts correctly against a stored timestamp", () => {
    expect(toSqliteTimestamp(new Date("2026-08-16T09:00:00Z")) < "2026-08-16 10:00:00").toBe(true);
  });
});

describe("describeFailureReason", () => {
  it("gives distinct wording for every reason", () => {
    const wordings = (
      ["unknown_user", "bad_password", "account_disabled", "invalid_input"] as const
    ).map(describeFailureReason);
    expect(new Set(wordings).size).toBe(4);
  });
});
