import { describe, expect, it } from "vitest";
import {
  formatLastRefreshed,
  lastRefreshedAt,
  parseSqliteTimestampUtc,
} from "./last-refreshed";
import type { StockPosition } from "./types";

function makePosition(overrides: Partial<StockPosition> = {}): StockPosition {
  return {
    accountId: 0,
    ticker: "AAPL",
    name: "Apple Inc.",
    type: "Stock",
    currentPriceCents: 15000,
    quantity: 10,
    dayGainLossCents: 0,
    valueCents: 150000,
    dayHighCents: 0,
    dayLowCents: 0,
    dividendRateCents: 0,
    costCents: 0,
    unitCostCents: 0,
    unrealizedGainLossCents: 0,
    unrealizedGainLossPct: 0,
    cusip: "",
    isin: "",
    assetClass: "",
    assetStrategy: "",
    estAnnualIncomeCents: 0,
    incomeEarnedCents: 0,
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
    ...overrides,
  };
}

describe("parseSqliteTimestampUtc", () => {
  it("reads a stored timestamp as UTC, not as local time", () => {
    // The bug this guards: without the "Z", Date.parse treats a space-separated
    // timestamp as local, so the instant shifts by the server's offset.
    expect(parseSqliteTimestampUtc("2026-09-21 19:42:00")).toBe(
      Date.UTC(2026, 8, 21, 19, 42, 0),
    );
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseSqliteTimestampUtc("  2026-09-21 19:42:00  ")).toBe(
      Date.UTC(2026, 8, 21, 19, 42, 0),
    );
  });

  it("returns undefined for an unparseable value rather than NaN", () => {
    expect(parseSqliteTimestampUtc("not a timestamp")).toBeUndefined();
    expect(parseSqliteTimestampUtc("")).toBeUndefined();
  });
});

describe("lastRefreshedAt", () => {
  it("returns the most recent updatedAt across positions", () => {
    const positions = [
      makePosition({ ticker: "AAPL", updatedAt: "2026-09-21 14:00:00" }),
      makePosition({ ticker: "MSFT", updatedAt: "2026-09-21 19:42:00" }),
      makePosition({ ticker: "VTI", updatedAt: "2026-09-20 23:59:59" }),
    ];
    expect(lastRefreshedAt(positions)).toBe("2026-09-21 19:42:00");
  });

  it("does not depend on the order positions arrive in", () => {
    const newest = makePosition({ ticker: "MSFT", updatedAt: "2026-09-21 19:42:00" });
    const older = makePosition({ ticker: "AAPL", updatedAt: "2026-09-21 14:00:00" });
    expect(lastRefreshedAt([newest, older])).toBe("2026-09-21 19:42:00");
    expect(lastRefreshedAt([older, newest])).toBe("2026-09-21 19:42:00");
  });

  it("returns undefined for an empty portfolio", () => {
    expect(lastRefreshedAt([])).toBeUndefined();
  });

  it("skips unreadable timestamps and still reports a readable one", () => {
    const positions = [
      makePosition({ ticker: "AAPL", updatedAt: "garbage" }),
      makePosition({ ticker: "MSFT", updatedAt: "2026-09-21 19:42:00" }),
    ];
    expect(lastRefreshedAt(positions)).toBe("2026-09-21 19:42:00");
  });

  it("returns undefined when no position carries a readable timestamp", () => {
    expect(lastRefreshedAt([makePosition({ updatedAt: "garbage" })])).toBeUndefined();
  });
});

describe("formatLastRefreshed", () => {
  it("renders a stored UTC instant on the reader's local clock", () => {
    // Asserted against the same conversion rather than a hard-coded string: the
    // test runner's timezone is not fixed, and the point of the function is that
    // the instant is right, not that any one zone formats it a given way.
    const expected = new Date(Date.UTC(2026, 8, 21, 19, 42, 0)).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    expect(formatLastRefreshed("2026-09-21 19:42:00")).toBe(expected);
  });

  it("returns undefined when there is nothing to show", () => {
    expect(formatLastRefreshed(undefined)).toBeUndefined();
  });

  it("returns undefined for an unparseable timestamp rather than 'Invalid Date'", () => {
    expect(formatLastRefreshed("garbage")).toBeUndefined();
  });
});
