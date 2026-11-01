import { describe, expect, it } from "vitest";
import {
  describeMarketClosure,
  isMarketDay,
  isMarketHoliday,
  isWeekend,
  marketClosure,
  nextMarketDay,
} from "./market-calendar";

// The dates below are the published NYSE calendars for 2026-2028. They are
// spelled out rather than computed in the test, because a test that recomputes
// the thing it is testing proves only that the code agrees with itself.
//
// Three years on purpose: one year would pass against a hard-coded table, and
// the point of the rules is that they keep working. 2026-2028 also happen to
// cover every interesting weekend roll -- see the cases at the bottom.

describe("isWeekend", () => {
  it("is true on Saturday and Sunday", () => {
    expect(isWeekend("2026-11-28")).toBe(true); // Saturday
    expect(isWeekend("2026-11-29")).toBe(true); // Sunday
  });

  it("is false on every weekday", () => {
    for (const date of ["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]) {
      expect(isWeekend(date)).toBe(false);
    }
  });

  it("rejects anything that is not a real YYYY-MM-DD date", () => {
    expect(() => isWeekend("2026-13-01")).toThrow();
    expect(() => isWeekend("2026-02-31")).toThrow();
    expect(() => isWeekend("26 Nov 2026")).toThrow();
    expect(() => isWeekend("")).toThrow();
  });
});

describe("isMarketHoliday", () => {
  const holidays: Record<number, string[]> = {
    2026: [
      "2026-01-01", // New Year's Day, Thursday
      "2026-01-19", // MLK
      "2026-02-16", // Washington's Birthday
      "2026-04-03", // Good Friday
      "2026-05-25", // Memorial Day
      "2026-06-19", // Juneteenth, Friday
      "2026-07-03", // Independence Day observed -- the 4th is a Saturday
      "2026-09-07", // Labor Day
      "2026-11-26", // Thanksgiving
      "2026-12-25", // Christmas, Friday
    ],
    2027: [
      "2027-01-01",
      "2027-01-18",
      "2027-02-15",
      "2027-03-26", // Good Friday -- a full week earlier than 2026
      "2027-05-31",
      "2027-06-18", // Juneteenth observed -- the 19th is a Saturday
      "2027-07-05", // Independence Day observed -- the 4th is a Sunday
      "2027-09-06",
      "2027-11-25",
      "2027-12-24", // Christmas observed -- the 25th is a Saturday
    ],
    2028: [
      // No New Year's Day: 1 Jan 2028 is a Saturday, and the NYSE does not
      // observe it on 31 December. See `observed`.
      "2028-01-17",
      "2028-02-21",
      "2028-04-14",
      "2028-05-29",
      "2028-06-19",
      "2028-07-04",
      "2028-09-04",
      "2028-11-23",
      "2028-12-25",
    ],
  };

  for (const [year, dates] of Object.entries(holidays)) {
    it(`closes on every ${year} holiday`, () => {
      for (const date of dates) {
        expect(isMarketHoliday(date), date).toBe(true);
        expect(isMarketDay(date), date).toBe(false);
      }
    });
  }

  it("does not observe New Year's Day when it falls on a Saturday", () => {
    // The documented exception: the market stays open on 31 Dec 2027 (a Friday)
    // rather than rolling the holiday back into the previous year.
    expect(isMarketDay("2027-12-31")).toBe(true);
    expect(isMarketHoliday("2028-01-03")).toBe(false); // nor forward onto the Monday
  });

  it("is false on a weekend, which is a closure but not a holiday", () => {
    expect(isMarketHoliday("2026-11-28")).toBe(false);
    expect(marketClosure("2026-11-28")).toBe("weekend");
  });

  it("stays open on the early-close days, which are not full closures", () => {
    // The market trades until 13:00 on these, so there are real closing prices.
    expect(isMarketDay("2026-11-27")).toBe(true); // Friday after Thanksgiving
    expect(isMarketDay("2026-12-24")).toBe(true); // Christmas Eve
  });

  it("stays open on an ordinary midweek day", () => {
    expect(isMarketDay("2026-11-18")).toBe(true);
    expect(marketClosure("2026-11-18")).toBeUndefined();
  });

  it("stays open the day either side of a holiday", () => {
    expect(isMarketDay("2026-11-25")).toBe(true); // Thanksgiving eve
    expect(isMarketDay("2026-05-22")).toBe(true); // the Friday before Memorial Day
  });
});

describe("marketClosure", () => {
  it("names the holiday", () => {
    expect(marketClosure("2026-11-26")).toBe("thanksgiving");
    expect(marketClosure("2026-04-03")).toBe("good-friday");
    expect(marketClosure("2026-07-03")).toBe("independence-day");
  });

  it("reports the weekend ahead of a holiday that lands on one", () => {
    // 4 July 2026 is a Saturday. It is closed because it is the weekend; the
    // holiday itself was observed on the Friday.
    expect(marketClosure("2026-07-04")).toBe("weekend");
    expect(marketClosure("2026-07-03")).toBe("independence-day");
  });
});

describe("nextMarketDay", () => {
  it("steps over a weekend", () => {
    expect(nextMarketDay("2026-11-20")).toBe("2026-11-23"); // Friday -> Monday
  });

  it("steps over a holiday", () => {
    expect(nextMarketDay("2026-11-25")).toBe("2026-11-27"); // Wed -> Fri, past Thanksgiving
  });

  it("steps over a holiday and the weekend behind it", () => {
    expect(nextMarketDay("2026-12-24")).toBe("2026-12-28"); // Thu -> Mon, past Christmas Friday
  });

  it("returns the next day when that day trades", () => {
    expect(nextMarketDay("2026-11-18")).toBe("2026-11-19");
  });

  it("crosses a year boundary", () => {
    expect(nextMarketDay("2026-12-31")).toBe("2027-01-04"); // past New Year's Friday + weekend
  });
});

describe("describeMarketClosure", () => {
  it("gives a phrase that reads inside a sentence", () => {
    expect(describeMarketClosure("2026-11-26")).toBe("Thanksgiving Day");
    expect(describeMarketClosure("2026-11-28")).toBe("the weekend");
  });

  it("is undefined on a trading day", () => {
    expect(describeMarketClosure("2026-11-18")).toBeUndefined();
  });
});
