import { describe, expect, it } from "vitest";
import {
  calendarAgeSince,
  formatCalendarAge,
  parseIsoDateLocal,
  startOfMonthIso,
  startOfWeekIso,
  startOfYearIso,
  toIsoDateLocal,
  todayIsoLocal,
} from "./date";

describe("toIsoDateLocal / todayIsoLocal", () => {
  it("formats a Date as its local calendar day", () => {
    expect(toIsoDateLocal(new Date(2026, 7, 4))).toBe("2026-08-04");
  });

  it("zero-pads single-digit months and days", () => {
    expect(toIsoDateLocal(new Date(2026, 0, 9))).toBe("2026-01-09");
  });

  it("uses the local day, not the UTC one, late in the evening", () => {
    // 23:30 local on 4 Aug is already 5 Aug in UTC for any negative offset, which
    // is exactly the case toISOString() would get wrong.
    expect(todayIsoLocal(new Date(2026, 7, 4, 23, 30))).toBe("2026-08-04");
  });
});

describe("parseIsoDateLocal", () => {
  it("parses a valid date to local midnight", () => {
    const date = parseIsoDateLocal("2026-08-04");
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(7);
    expect(date.getDate()).toBe(4);
    expect(date.getHours()).toBe(0);
  });

  it("rejects a malformed string", () => {
    expect(() => parseIsoDateLocal("08/04/2026")).toThrow();
    expect(() => parseIsoDateLocal("2026-8-4")).toThrow();
    expect(() => parseIsoDateLocal("")).toThrow();
  });

  it("rejects a well-formed but impossible date instead of rolling it forward", () => {
    expect(() => parseIsoDateLocal("2026-02-31")).toThrow();
    expect(() => parseIsoDateLocal("2026-13-01")).toThrow();
  });
});

describe("startOfWeekIso", () => {
  it("returns the Monday of that week", () => {
    // 2026-08-04 is a Tuesday.
    expect(startOfWeekIso("2026-08-04")).toBe("2026-08-03");
  });

  it("returns the day itself when it is already Monday", () => {
    expect(startOfWeekIso("2026-08-03")).toBe("2026-08-03");
  });

  it("puts Sunday in the week that started six days earlier, not the next one", () => {
    // 2026-08-09 is a Sunday; its Monday is 2026-08-03.
    expect(startOfWeekIso("2026-08-09")).toBe("2026-08-03");
  });

  it("crosses a month boundary", () => {
    // 2026-08-01 is a Saturday; its Monday is in July.
    expect(startOfWeekIso("2026-08-01")).toBe("2026-07-27");
  });
});

describe("startOfMonthIso and startOfYearIso", () => {
  it("returns the first of the month", () => {
    expect(startOfMonthIso("2026-08-04")).toBe("2026-08-01");
    expect(startOfMonthIso("2026-08-01")).toBe("2026-08-01");
  });

  it("returns the first of the year", () => {
    expect(startOfYearIso("2026-08-04")).toBe("2026-01-01");
  });

  it("rejects an invalid date rather than guessing", () => {
    expect(() => startOfMonthIso("not-a-date")).toThrow();
    expect(() => startOfYearIso("2026-02-31")).toThrow();
  });
});

describe("calendarAgeSince", () => {
  it("counts whole years, months and days", () => {
    expect(calendarAgeSince("2019-06-09", new Date(2026, 7, 29))).toEqual({
      years: 7,
      months: 2,
      days: 20,
    });
  });

  it("reports an exact anniversary as whole years, with no stray days", () => {
    // The case `days / 365` gets wrong: two leap days fall in this span, so a
    // divisor would say "5 years, 11 months" where a reader expects 6 years.
    expect(calendarAgeSince("2019-06-09", new Date(2025, 5, 9))).toEqual({
      years: 6,
      months: 0,
      days: 0,
    });
  });

  it("counts a month from the 31st into a shorter month without going negative", () => {
    // 31 Jan + 1 month clamps to 28 Feb, so 31 Jan -> 1 Mar is 1 month and 1 day.
    // Subtracting the day fields and borrowing February's 28 gave "1 month, -2 days".
    expect(calendarAgeSince("2026-01-31", new Date(2026, 2, 1))).toEqual({
      years: 0,
      months: 1,
      days: 1,
    });
  });

  it("does the same in a leap year, where the short month has 29", () => {
    expect(calendarAgeSince("2024-01-31", new Date(2024, 2, 1))).toEqual({
      years: 0,
      months: 1,
      days: 1,
    });
  });

  it("counts a month from the 31st into a 30-day month", () => {
    expect(calendarAgeSince("2026-03-31", new Date(2026, 4, 1))).toEqual({
      years: 0,
      months: 1,
      days: 1,
    });
  });

  it("keeps an ordinary mid-month span exact", () => {
    // 15 Jan + 1 month is 15 Feb, and 15 Feb -> 10 Mar is 23 days.
    expect(calendarAgeSince("2026-01-15", new Date(2026, 2, 10))).toEqual({
      years: 0,
      months: 1,
      days: 23,
    });
  });

  it("treats the clamped month-end as an exact anniversary", () => {
    // There is no 31 Feb; 28 Feb is one whole month after 31 Jan, with nothing left.
    expect(calendarAgeSince("2026-01-31", new Date(2026, 1, 28))).toEqual({
      years: 0,
      months: 1,
      days: 0,
    });
  });

  it("never reports a negative day count, over ten years of month ends", () => {
    // The bug this guards was a negative `days`, which no caller can render.
    for (let offset = 0; offset < 3_650; offset += 1) {
      const then = new Date(2020, 0, 1 + offset);
      const iso = `${then.getFullYear()}-${String(then.getMonth() + 1).padStart(2, "0")}-${String(then.getDate()).padStart(2, "0")}`;
      const age = calendarAgeSince(iso, new Date(2030, 0, 1));
      expect(age.days).toBeGreaterThanOrEqual(0);
      expect(age.months).toBeGreaterThanOrEqual(0);
      expect(age.years).toBeGreaterThanOrEqual(0);
      expect(age.months).toBeLessThan(12);
    }
  });

  it("borrows a month across a year boundary", () => {
    expect(calendarAgeSince("2025-12-20", new Date(2026, 0, 5))).toEqual({
      years: 0,
      months: 0,
      days: 16,
    });
  });

  it("ignores the time of day in `now`", () => {
    expect(calendarAgeSince("2026-08-28", new Date(2026, 7, 29, 23, 45))).toEqual({
      years: 0,
      months: 0,
      days: 1,
    });
  });

  it("is all zeros for today", () => {
    expect(calendarAgeSince("2026-08-29", new Date(2026, 7, 29, 10, 0))).toEqual({
      years: 0,
      months: 0,
      days: 0,
    });
  });

  it("clamps a future date to zero rather than going negative", () => {
    // A camera with a wrong clock. "-3 days ago" is worse than "today".
    expect(calendarAgeSince("2027-01-01", new Date(2026, 7, 29))).toEqual({
      years: 0,
      months: 0,
      days: 0,
    });
  });

  it("rejects a malformed date rather than guessing", () => {
    expect(() => calendarAgeSince("not-a-date")).toThrow();
    expect(() => calendarAgeSince("2019-02-30")).toThrow();
  });
});

describe("formatCalendarAge", () => {
  it("names all three units when all three are non-zero", () => {
    expect(formatCalendarAge({ years: 7, months: 2, days: 20 })).toBe(
      "7 years, 2 months, 20 days ago",
    );
  });

  it("drops zero units", () => {
    expect(formatCalendarAge({ years: 6, months: 0, days: 0 })).toBe("6 years ago");
    expect(formatCalendarAge({ years: 0, months: 0, days: 3 })).toBe("3 days ago");
    expect(formatCalendarAge({ years: 2, months: 0, days: 5 })).toBe("2 years, 5 days ago");
  });

  it("singularises a unit of one", () => {
    expect(formatCalendarAge({ years: 1, months: 1, days: 1 })).toBe(
      "1 year, 1 month, 1 day ago",
    );
  });

  it("says today rather than 0 days ago", () => {
    expect(formatCalendarAge({ years: 0, months: 0, days: 0 })).toBe("today");
  });
});
