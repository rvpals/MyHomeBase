import { describe, expect, it } from "vitest";
import type { IpAllowlistRepository, SiteVisitRepository } from "./ports";
import {
  DEFAULT_RETENTION_DAYS,
  allowIpAddress,
  deleteSiteVisits,
  disallowIpAddress,
  listSiteVisits,
  listVisitsByWeek,
  markSuspiciousReviewed,
  pruneSiteVisits,
  recordSiteVisit,
  toSqliteTimestamp,
} from "./site-visits";
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

/**
 * An in-memory double. The use-cases depend on the port, so the tests supply their
 * own storage and never touch SQLite — which is also what keeps them fast enough to
 * assert every branch.
 */
class FakeVisitRepo implements SiteVisitRepository {
  recorded: NewSiteVisit[] = [];
  visits: SiteVisit[] = [];
  ipHistory: Omit<IpHistory, "allowlisted"> = {
    recentVisits: 0,
    totalVisits: 0,
    authAttempts: 0,
    authFailures: 0,
  };
  historyQueriedWith?: { ipAddress: string; burstWindowMinutes: number };
  reviewedWith?: { asOf: string; reviewedAt: string };
  scoredWith: { ipAddress: string; level: SuspicionLevel; reviewedAt?: string }[] = [];
  deletedIds: number[] = [];
  deletedBefore?: string;
  throwOnRecord = false;

  recordVisit(visit: NewSiteVisit): void {
    if (this.throwOnRecord) throw new Error("database is gone");
    this.recorded.push(visit);
  }

  listVisits(filter: SiteVisitFilter): SiteVisit[] {
    return this.visits.slice(0, filter.limit ?? 1000);
  }

  getSummary(): SiteVisitSummary {
    return {
      totalVisits: this.visits.length,
      uniqueIps: new Set(this.visits.map((v) => v.ipAddress ?? "")).size,
      suspiciousVisits: this.visits.filter((v) => v.suspicion === "suspicious").length,
      unreviewedSuspicious: this.visits.filter(
        (v) => v.suspicion === "suspicious" && v.reviewedAt === undefined,
      ).length,
    };
  }

  getIpHistory(ipAddress: string, burstWindowMinutes: number) {
    this.historyQueriedWith = { ipAddress, burstWindowMinutes };
    return this.ipHistory;
  }

  markSuspiciousReviewed(asOf: string, reviewedAt: string): void {
    this.reviewedWith = { asOf, reviewedAt };
  }

  setSuspicionForIp(ipAddress: string, level: SuspicionLevel, reviewedAt?: string): number {
    this.scoredWith.push({ ipAddress, level, reviewedAt });
    return 3;
  }

  deleteVisits(ids: number[]): number {
    this.deletedIds = ids;
    return ids.length;
  }

  deleteVisitsBefore(cutoff: string): number {
    this.deletedBefore = cutoff;
    return 7;
  }
}

class FakeAllowlistRepo implements IpAllowlistRepository {
  entries: IpAllowlistEntry[] = [];
  added: NewIpAllowlistEntry[] = [];
  allowed = new Set<string>();
  removeSucceeds = true;

  add(entry: NewIpAllowlistEntry): boolean {
    this.added.push(entry);
    if (this.allowed.has(entry.ipAddress)) return false;
    this.allowed.add(entry.ipAddress);
    return true;
  }

  list(): IpAllowlistEntry[] {
    return this.entries;
  }

  isAllowed(ipAddress: string): boolean {
    return this.allowed.has(ipAddress);
  }

  remove(): boolean {
    return this.removeSucceeds;
  }
}

const BROWSER = "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/604.1";

describe("recordSiteVisit", () => {
  it("records an ordinary arrival as normal", () => {
    const visits = new FakeVisitRepo();
    const allowlist = new FakeAllowlistRepo();

    recordSiteVisit({ ipAddress: "203.0.113.7", userAgent: BROWSER }, visits, allowlist);

    expect(visits.recorded).toHaveLength(1);
    expect(visits.recorded[0].suspicion).toBe("normal");
    expect(visits.recorded[0].ipAddress).toBe("203.0.113.7");
  });

  it("defaults the path to the site root", () => {
    const visits = new FakeVisitRepo();
    recordSiteVisit({ ipAddress: "203.0.113.7" }, visits, new FakeAllowlistRepo());

    expect(visits.recorded[0].path).toBe("/");
  });

  it("scores a scanner arrival as suspicious", () => {
    const visits = new FakeVisitRepo();
    recordSiteVisit(
      { ipAddress: "45.132.8.7", userAgent: "sqlmap/1.7" },
      visits,
      new FakeAllowlistRepo(),
    );

    expect(visits.recorded[0].suspicion).toBe("suspicious");
  });

  it("still records an allowlisted address, but scores it normal", () => {
    // The rule from migrations/0103: vouching suppresses alarm, never evidence.
    const visits = new FakeVisitRepo();
    const allowlist = new FakeAllowlistRepo();
    allowlist.allowed.add("192.168.1.50");

    recordSiteVisit(
      { ipAddress: "192.168.1.50", userAgent: "curl/8.4.0" },
      visits,
      allowlist,
    );

    expect(visits.recorded).toHaveLength(1);
    expect(visits.recorded[0].suspicion).toBe("normal");
  });

  it("skips the history lookup entirely when there is no address", () => {
    const visits = new FakeVisitRepo();
    recordSiteVisit({ userAgent: BROWSER }, visits, new FakeAllowlistRepo());

    expect(visits.historyQueriedWith).toBeUndefined();
    expect(visits.recorded).toHaveLength(1);
  });

  it("passes the burst window to the history lookup", () => {
    const visits = new FakeVisitRepo();
    recordSiteVisit({ ipAddress: "203.0.113.7" }, visits, new FakeAllowlistRepo());

    expect(visits.historyQueriedWith?.burstWindowMinutes).toBeGreaterThan(0);
  });

  it("truncates a hostile user agent rather than failing the write", () => {
    const visits = new FakeVisitRepo();
    recordSiteVisit(
      { ipAddress: "203.0.113.7", userAgent: "x".repeat(9000) },
      visits,
      new FakeAllowlistRepo(),
    );

    expect(visits.recorded).toHaveLength(1);
    expect(visits.recorded[0].userAgent!.length).toBeLessThanOrEqual(400);
  });

  it("never throws when the database fails", () => {
    // This runs a hair before a logged-out visitor's redirect. A failed audit write
    // must not turn their arrival into an error page.
    const visits = new FakeVisitRepo();
    visits.throwOnRecord = true;

    expect(() =>
      recordSiteVisit({ ipAddress: "203.0.113.7" }, visits, new FakeAllowlistRepo()),
    ).not.toThrow();
  });

  it("never throws on malformed input, and writes nothing", () => {
    const visits = new FakeVisitRepo();

    expect(() =>
      recordSiteVisit(
        { ipAddress: 42 as unknown as string },
        visits,
        new FakeAllowlistRepo(),
      ),
    ).not.toThrow();
    expect(visits.recorded).toHaveLength(0);
  });
});

describe("listSiteVisits", () => {
  it("applies the schema's default limit", () => {
    const visits = new FakeVisitRepo();
    expect(() => listSiteVisits({}, visits)).not.toThrow();
  });

  it("rejects a limit beyond the cap", () => {
    const visits = new FakeVisitRepo();
    expect(() => listSiteVisits({ limit: 99999 }, visits)).toThrow();
  });

  it("rejects a malformed since date", () => {
    const visits = new FakeVisitRepo();
    expect(() => listSiteVisits({ since: "19/09/2026" }, visits)).toThrow(/YYYY-MM-DD/);
  });
});

describe("listVisitsByWeek", () => {
  it("returns the grouped tree", () => {
    const visits = new FakeVisitRepo();
    visits.visits = [
      {
        id: 1,
        ipAddress: "1.1.1.1",
        path: "/",
        suspicion: "normal",
        createdAt: "2026-09-19 12:00:00",
      },
    ];

    const weeks = listVisitsByWeek({}, visits);

    expect(weeks).toHaveLength(1);
    expect(weeks[0].days[0].visits).toHaveLength(1);
  });
});

describe("markSuspiciousReviewed", () => {
  it("bounds the acknowledgement to this instant", () => {
    // A visit arriving while the admin reads the screen must stay unreviewed.
    const visits = new FakeVisitRepo();
    const now = new Date("2026-09-21T10:00:00Z");

    markSuspiciousReviewed(visits, now);

    expect(visits.reviewedWith?.asOf).toBe("2026-09-21 10:00:00");
  });
});

describe("deleteSiteVisits", () => {
  it("deletes the selected rows", () => {
    const visits = new FakeVisitRepo();

    expect(deleteSiteVisits([3, 1, 2], visits)).toBe(3);
    expect(visits.deletedIds).toEqual([3, 1, 2]);
  });

  it("dedupes ids", () => {
    const visits = new FakeVisitRepo();
    deleteSiteVisits([5, 5, 5], visits);

    expect(visits.deletedIds).toEqual([5]);
  });

  it("throws on an empty selection rather than silently succeeding", () => {
    // A delete is a deliberate act by an admin; "you selected nothing" must reach them.
    expect(() => deleteSiteVisits([], new FakeVisitRepo())).toThrow(/at least one/);
  });

  it("rejects a non-positive id", () => {
    expect(() => deleteSiteVisits([0], new FakeVisitRepo())).toThrow();
  });
});

describe("pruneSiteVisits", () => {
  it("deletes before the retention cutoff", () => {
    const visits = new FakeVisitRepo();
    const now = new Date("2026-09-21T00:00:00Z");

    expect(pruneSiteVisits(visits, DEFAULT_RETENTION_DAYS, now)).toBe(7);
    expect(visits.deletedBefore).toBe("2026-06-23 00:00:00");
  });

  it("rejects a zero-day retention that would wipe the table", () => {
    expect(() => pruneSiteVisits(new FakeVisitRepo(), 0)).toThrow();
  });
});

describe("allowIpAddress", () => {
  it("vouches for the address and re-scores its past visits", () => {
    // Without the re-score, yesterday's red rows sit there unchanged and the feature
    // reads as broken.
    const visits = new FakeVisitRepo();
    const allowlist = new FakeAllowlistRepo();

    const rescored = allowIpAddress(
      { ipAddress: "192.168.1.50", label: "my phone" },
      allowlist,
      visits,
      new Date("2026-09-21T10:00:00Z"),
    );

    expect(rescored).toBe(3);
    expect(allowlist.isAllowed("192.168.1.50")).toBe(true);
    expect(visits.scoredWith[0]).toEqual({
      ipAddress: "192.168.1.50",
      level: "normal",
      reviewedAt: "2026-09-21 10:00:00",
    });
  });

  it("is harmless to call twice for the same address", () => {
    const visits = new FakeVisitRepo();
    const allowlist = new FakeAllowlistRepo();

    allowIpAddress({ ipAddress: "192.168.1.50" }, allowlist, visits);
    expect(() => allowIpAddress({ ipAddress: "192.168.1.50" }, allowlist, visits)).not.toThrow();
    expect(visits.scoredWith).toHaveLength(2);
  });

  it("rejects a blank address", () => {
    // Vouching for "nothing" would allowlist every unattributable visit at once.
    expect(() =>
      allowIpAddress({ ipAddress: "   " }, new FakeAllowlistRepo(), new FakeVisitRepo()),
    ).toThrow(/address is required/);
  });

  it("keeps an unusual but real address shape", () => {
    const allowlist = new FakeAllowlistRepo();
    allowIpAddress({ ipAddress: "fe80::1%eth0" }, allowlist, new FakeVisitRepo());

    expect(allowlist.added[0].ipAddress).toBe("fe80::1%eth0");
  });
});

describe("disallowIpAddress", () => {
  it("re-scores the address's visits back to watch", () => {
    // Un-trusting must stop hiding that address's past behaviour.
    const visits = new FakeVisitRepo();
    const allowlist = new FakeAllowlistRepo();

    expect(disallowIpAddress(1, "192.168.1.50", allowlist, visits)).toBe(3);
    expect(visits.scoredWith[0]).toEqual({
      ipAddress: "192.168.1.50",
      level: "watch",
      reviewedAt: undefined,
    });
  });

  it("does nothing when the entry was not there", () => {
    const visits = new FakeVisitRepo();
    const allowlist = new FakeAllowlistRepo();
    allowlist.removeSucceeds = false;

    expect(disallowIpAddress(99, "192.168.1.50", allowlist, visits)).toBe(0);
    expect(visits.scoredWith).toHaveLength(0);
  });
});

describe("toSqliteTimestamp", () => {
  it("matches SQLite's datetime('now') shape in UTC", () => {
    expect(toSqliteTimestamp(new Date("2026-09-21T10:30:45.123Z"))).toBe("2026-09-21 10:30:45");
  });
});
