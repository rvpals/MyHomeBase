import { describe, expect, it } from "vitest";
import { formatDayLabel, formatWeekLabel, groupVisitsByWeekAndDay } from "./grouping";
import type { SiteVisit, SuspicionLevel } from "./types";

let nextId = 1;

/**
 * `createdAt` is written as SQLite writes it: `YYYY-MM-DD HH:MM:SS` in UTC.
 * Midday is used throughout so no test result depends on the machine's timezone —
 * the UTC-to-local conversion cannot cross a date boundary from noon in any real
 * offset. The one test that *does* care about the boundary sets its time explicitly.
 */
function visit(createdAt: string, overrides: Partial<SiteVisit> = {}): SiteVisit {
  return {
    id: nextId++,
    ipAddress: "203.0.113.7",
    path: "/",
    suspicion: "normal" as SuspicionLevel,
    createdAt,
    ...overrides,
  };
}

describe("groupVisitsByWeekAndDay", () => {
  it("returns nothing for no visits", () => {
    expect(groupVisitsByWeekAndDay([])).toEqual([]);
  });

  it("groups a single visit into one week and one day", () => {
    // 2026-09-19 is a Saturday, in ISO week 38 of 2026.
    const weeks = groupVisitsByWeekAndDay([visit("2026-09-19 12:00:00")]);

    expect(weeks).toHaveLength(1);
    expect(weeks[0].isoWeek).toBe(38);
    expect(weeks[0].isoYear).toBe(2026);
    expect(weeks[0].weekStart).toBe("2026-09-14");
    expect(weeks[0].days).toHaveLength(1);
    expect(weeks[0].days[0].date).toBe("2026-09-19");
  });

  it("puts days of the same week together and orders both levels newest first", () => {
    const weeks = groupVisitsByWeekAndDay([
      visit("2026-09-14 12:00:00"),
      visit("2026-09-19 12:00:00"),
      visit("2026-09-16 12:00:00"),
    ]);

    expect(weeks).toHaveLength(1);
    expect(weeks[0].days.map((day) => day.date)).toEqual([
      "2026-09-19",
      "2026-09-16",
      "2026-09-14",
    ]);
  });

  it("orders visits inside a day newest first", () => {
    const weeks = groupVisitsByWeekAndDay([
      visit("2026-09-19 09:00:00"),
      visit("2026-09-19 17:00:00"),
      visit("2026-09-19 13:00:00"),
    ]);

    expect(weeks[0].days[0].visits.map((v) => v.createdAt)).toEqual([
      "2026-09-19 17:00:00",
      "2026-09-19 13:00:00",
      "2026-09-19 09:00:00",
    ]);
  });

  it("splits across a week boundary — Sunday belongs to the week that started Monday", () => {
    // 2026-09-20 is a Sunday (week 38); 2026-09-21 is the Monday of week 39.
    const weeks = groupVisitsByWeekAndDay([
      visit("2026-09-20 12:00:00"),
      visit("2026-09-21 12:00:00"),
    ]);

    expect(weeks).toHaveLength(2);
    expect(weeks[0].isoWeek).toBe(39);
    expect(weeks[1].isoWeek).toBe(38);
  });

  it("counts unique IPs per day without double-counting a repeat visitor", () => {
    const weeks = groupVisitsByWeekAndDay([
      visit("2026-09-19 10:00:00", { ipAddress: "1.1.1.1" }),
      visit("2026-09-19 11:00:00", { ipAddress: "1.1.1.1" }),
      visit("2026-09-19 12:00:00", { ipAddress: "2.2.2.2" }),
    ]);

    expect(weeks[0].days[0].totalVisits).toBe(3);
    expect(weeks[0].days[0].uniqueIps).toBe(2);
  });

  it("counts a week's unique IPs across its days rather than summing them", () => {
    // The same address on two days is one address, not two. Summing day counts would
    // report 2 and overstate how many distinct visitors the week saw.
    const weeks = groupVisitsByWeekAndDay([
      visit("2026-09-15 12:00:00", { ipAddress: "1.1.1.1" }),
      visit("2026-09-17 12:00:00", { ipAddress: "1.1.1.1" }),
    ]);

    expect(weeks[0].totalVisits).toBe(2);
    expect(weeks[0].uniqueIps).toBe(1);
  });

  it("collapses blank addresses into a single unknown bucket", () => {
    const weeks = groupVisitsByWeekAndDay([
      visit("2026-09-19 10:00:00", { ipAddress: undefined }),
      visit("2026-09-19 11:00:00", { ipAddress: undefined }),
    ]);

    expect(weeks[0].days[0].uniqueIps).toBe(1);
  });

  it("counts suspicious visits at both levels", () => {
    const weeks = groupVisitsByWeekAndDay([
      visit("2026-09-19 10:00:00", { suspicion: "suspicious" }),
      visit("2026-09-19 11:00:00", { suspicion: "watch" }),
      visit("2026-09-17 11:00:00", { suspicion: "suspicious" }),
    ]);

    expect(weeks[0].suspiciousVisits).toBe(2);
    expect(weeks[0].days[0].suspiciousVisits).toBe(1);
  });

  it("skips an unparseable timestamp instead of throwing", () => {
    // One malformed row must not blank an admin screen.
    const weeks = groupVisitsByWeekAndDay([
      visit("not-a-timestamp"),
      visit("2026-09-19 12:00:00"),
    ]);

    expect(weeks).toHaveLength(1);
    expect(weeks[0].days[0].totalVisits).toBe(1);
  });

  it("accepts a timestamp that already carries a zone", () => {
    const weeks = groupVisitsByWeekAndDay([visit("2026-09-19T12:00:00Z")]);

    expect(weeks).toHaveLength(1);
    expect(weeks[0].days[0].date).toBe("2026-09-19");
  });

  it("buckets a stored UTC timestamp on the reader's local calendar", () => {
    // The stored value is UTC. The date a visit is filed under is the LOCAL date, so
    // this asserts the conversion happened rather than the raw string being sliced.
    const weeks = groupVisitsByWeekAndDay([visit("2026-09-19 23:30:00")]);

    const expected = new Date("2026-09-19T23:30:00Z");
    const expectedDate = `${expected.getFullYear()}-${String(expected.getMonth() + 1).padStart(2, "0")}-${String(expected.getDate()).padStart(2, "0")}`;

    expect(weeks[0].days[0].date).toBe(expectedDate);
  });
});

describe("formatDayLabel", () => {
  it("names the weekday and the date", () => {
    expect(formatDayLabel("2026-09-19")).toBe("Sat Sep 19");
  });

  it("throws on a malformed date", () => {
    expect(() => formatDayLabel("19/09/2026")).toThrow(/YYYY-MM-DD/);
  });
});

describe("formatWeekLabel", () => {
  it("collapses the month when a week stays inside one", () => {
    expect(formatWeekLabel("2026-09-14")).toBe("Week 38 · Sep 14–20");
  });

  it("names both months when a week spans two", () => {
    // 2026-09-28 is a Monday; the week runs into October.
    expect(formatWeekLabel("2026-09-28")).toBe("Week 40 · Sep 28 – Oct 4");
  });
});
