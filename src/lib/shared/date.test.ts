import { describe, expect, it } from "vitest";
import {
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
