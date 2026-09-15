import { describe, expect, it } from "vitest";
import { describeClock, isoWeekNumber, isoWeekYear } from "./clock";

describe("isoWeekNumber", () => {
  it("numbers a mid-year week", () => {
    // 13 Sep 2026 is a Sunday, the last day of week 37.
    expect(isoWeekNumber("2026-09-13")).toBe(37);
  });

  it("keeps Sunday in the week that started on Monday", () => {
    // The Monday-to-Sunday span either side of the reading above: one week, one
    // number. A Sunday-start implementation splits these across two.
    expect(isoWeekNumber("2026-09-07")).toBe(37);
    expect(isoWeekNumber("2026-09-13")).toBe(37);
    expect(isoWeekNumber("2026-09-14")).toBe(38);
  });

  it("puts a Thursday 1 January in week 1", () => {
    // Week 1 is the week containing the year's first Thursday, so a 1 Jan that IS
    // a Thursday starts it.
    expect(isoWeekNumber("2026-01-01")).toBe(1);
  });

  it("puts a Friday 1 January in the last week of the year before", () => {
    // 2027-01-01 is a Friday, so its week's Thursday is 31 Dec 2026 — week 53 of
    // 2026, not week 1 of 2027. The case a `dayOfYear / 7` implementation gets
    // most obviously wrong.
    expect(isoWeekNumber("2027-01-01")).toBe(53);
    expect(isoWeekYear("2027-01-01")).toBe(2026);
  });

  it("puts a late-December Monday in week 1 of the next year", () => {
    // 2024-12-30 is a Monday whose week's Thursday is 2 Jan 2025.
    expect(isoWeekNumber("2024-12-30")).toBe(1);
    expect(isoWeekYear("2024-12-30")).toBe(2025);
  });

  it("counts 53 weeks in a long year", () => {
    // 2026 is a 53-week ISO year: it starts on a Thursday. 31 Dec 2026 is that
    // 53rd week, and the year cannot run to 54.
    expect(isoWeekNumber("2026-12-31")).toBe(53);
    expect(isoWeekYear("2026-12-31")).toBe(2026);
  });

  it("numbers the week straddling a leap day", () => {
    // 29 Feb 2028 is a Tuesday. Nothing special should happen — the Thursday
    // pivot means there is no leap-year branch to get wrong.
    expect(isoWeekNumber("2028-02-29")).toBe(9);
  });

  it("rejects a malformed date", () => {
    expect(() => isoWeekNumber("13/09/2026")).toThrow(/YYYY-MM-DD/);
  });

  it("rejects a well-formed but impossible date", () => {
    // The case the bare Date constructor would roll forward to 3 March.
    expect(() => isoWeekNumber("2026-02-31")).toThrow(/not a real date/);
  });
});

describe("isoWeekYear", () => {
  it("matches the calendar year away from the boundary", () => {
    expect(isoWeekYear("2026-09-13")).toBe(2026);
  });

  it("rejects a malformed date", () => {
    expect(() => isoWeekYear("")).toThrow(/YYYY-MM-DD/);
  });
});

describe("describeClock", () => {
  it("reads a day into its display parts", () => {
    const reading = describeClock(new Date(2026, 8, 13, 14, 32));

    expect(reading).toEqual({
      isoDate: "2026-09-13",
      weekday: "Sunday",
      longDate: "13 September 2026",
      weekNumber: 37,
      weekYear: 2026,
    });
  });

  it("files a late evening under the local day, not the UTC one", () => {
    // 23:30 local is already tomorrow in UTC at any negative offset — the card
    // would otherwise show tomorrow's date, and tomorrow's week number with it.
    expect(describeClock(new Date(2026, 8, 13, 23, 30)).isoDate).toBe("2026-09-13");
  });

  it("carries the ISO week year across a New Year boundary", () => {
    const reading = describeClock(new Date(2027, 0, 1, 9, 0));

    expect(reading.longDate).toBe("1 January 2027");
    // The date is 2027 but the week is 2026's 53rd — both are true at once, which
    // is exactly why the reading carries the week year separately.
    expect(reading.weekNumber).toBe(53);
    expect(reading.weekYear).toBe(2026);
  });
});
