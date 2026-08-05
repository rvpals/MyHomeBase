import { describe, expect, it } from "vitest";
import type { StockPosition } from "@/lib/stock-positions";
import type { DailySnapshotRepository } from "./ports";
import type { UpsertDailySnapshotInput } from "./schema";
import {
  captureDailySnapshot,
  computeDailySnapshot,
  deleteSnapshot,
  getSnapshot,
  listSnapshots,
  snapshotBucketFor,
  snapshotChangePct,
  summarizeSnapshotPeriod,
  summarizeToDate,
} from "./stock-daily-snapshot";
import type { DailySnapshot } from "./types";

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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<DailySnapshot> = {}): DailySnapshot {
  return {
    snapshotDate: "2026-08-03",
    stockValueCents: 0,
    etfValueCents: 0,
    otherValueCents: 0,
    totalValueCents: 0,
    stockGainLossCents: 0,
    etfGainLossCents: 0,
    otherGainLossCents: 0,
    totalGainLossCents: 0,
    positionCount: 0,
    createdAt: "2026-08-03T00:00:00.000Z",
    updatedAt: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

// Hand-written fake — an in-memory table keyed by date, same contract as SQLite's
// ON CONFLICT upsert.
function fakeRepo(seed: DailySnapshot[] = []): DailySnapshotRepository {
  let snapshots = [...seed];
  return {
    listSnapshots(range) {
      const rows =
        range === undefined
          ? snapshots
          : snapshots.filter(
              (snapshot) =>
                snapshot.snapshotDate >= range.fromDate && snapshot.snapshotDate <= range.toDate,
            );
      return [...rows].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
    },
    getSnapshot(snapshotDate) {
      return snapshots.find((snapshot) => snapshot.snapshotDate === snapshotDate);
    },
    upsertSnapshot(input: UpsertDailySnapshotInput, totals) {
      const existing = snapshots.find((snapshot) => snapshot.snapshotDate === input.snapshotDate);
      const saved: DailySnapshot = {
        ...input,
        ...totals,
        createdAt: existing?.createdAt ?? "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-04T00:00:00.000Z",
      };
      snapshots = existing
        ? snapshots.map((snapshot) =>
            snapshot.snapshotDate === input.snapshotDate ? saved : snapshot,
          )
        : [...snapshots, saved];
      return saved;
    },
    deleteSnapshot(snapshotDate) {
      snapshots = snapshots.filter((snapshot) => snapshot.snapshotDate !== snapshotDate);
    },
  };
}

describe("snapshotBucketFor", () => {
  it("separates Stock and ETF and lumps everything else together", () => {
    expect(snapshotBucketFor(makePosition({ type: "Stock" }))).toBe("stock");
    expect(snapshotBucketFor(makePosition({ type: "ETF" }))).toBe("etf");
    expect(snapshotBucketFor(makePosition({ type: "Bond" }))).toBe("other");
    expect(snapshotBucketFor(makePosition({ type: "MutualFund" }))).toBe("other");
    expect(snapshotBucketFor(makePosition({ type: "Crypto" }))).toBe("other");
    expect(snapshotBucketFor(makePosition({ type: "Other" }))).toBe("other");
  });
});

describe("snapshotChangePct", () => {
  it("measures the move against the value before it moved", () => {
    // Ended at $105 after a +$5 day, so it started at $100 — that's +5%, not +4.76%.
    expect(
      snapshotChangePct(makeSnapshot({ totalValueCents: 10500, totalGainLossCents: 500 })),
    ).toBeCloseTo(5, 5);
  });

  it("goes negative on a down day", () => {
    expect(
      snapshotChangePct(makeSnapshot({ totalValueCents: 9500, totalGainLossCents: -500 })),
    ).toBeCloseTo(-5, 5);
  });

  it("is zero on a flat day", () => {
    expect(snapshotChangePct(makeSnapshot({ totalValueCents: 10000, totalGainLossCents: 0 }))).toBe(0);
  });

  it("returns 0 rather than Infinity when the day started from nothing", () => {
    expect(snapshotChangePct(makeSnapshot({ totalValueCents: 500, totalGainLossCents: 500 }))).toBe(0);
  });
});

describe("computeDailySnapshot", () => {
  const positions = [
    makePosition({ ticker: "AAPL", type: "Stock", currentPriceCents: 15000, quantity: 10, dayGainLossCents: 5000 }),
    makePosition({ ticker: "MSFT", type: "Stock", currentPriceCents: 40000, quantity: 5, dayGainLossCents: -1000 }),
    makePosition({ ticker: "SPY", type: "ETF", currentPriceCents: 45000, quantity: 4, dayGainLossCents: 800 }),
    makePosition({ ticker: "QACDS", type: "Other", currentPriceCents: 100, quantity: 72.59, dayGainLossCents: 0 }),
  ];

  it("values each bucket as shares x current price", () => {
    const snapshot = computeDailySnapshot(positions, "2026-08-04");
    expect(snapshot.stockValueCents).toBe(150000 + 200000);
    expect(snapshot.etfValueCents).toBe(180000);
    expect(snapshot.otherValueCents).toBe(7259);
  });

  it("makes the total the sum of its three parts", () => {
    const snapshot = computeDailySnapshot(positions, "2026-08-04");
    expect(snapshot.totalValueCents).toBe(
      snapshot.stockValueCents + snapshot.etfValueCents + snapshot.otherValueCents,
    );
    expect(snapshot.totalGainLossCents).toBe(
      snapshot.stockGainLossCents + snapshot.etfGainLossCents + snapshot.otherGainLossCents,
    );
  });

  it("keeps a losing bucket negative rather than clamping it", () => {
    const snapshot = computeDailySnapshot(
      [makePosition({ type: "Stock", dayGainLossCents: -25000 })],
      "2026-08-04",
    );
    expect(snapshot.stockGainLossCents).toBe(-25000);
    expect(snapshot.totalGainLossCents).toBe(-25000);
  });

  it("rounds a fractional share's value to whole cents", () => {
    // 21194 cents x 442.4575 shares = 9,377,444.255 -> 9,377,444 cents ($93,774.44).
    const snapshot = computeDailySnapshot(
      [makePosition({ type: "Stock", currentPriceCents: 21194, quantity: 442.4575 })],
      "2026-08-04",
    );
    expect(snapshot.stockValueCents).toBe(9377444);
    expect(Number.isInteger(snapshot.stockValueCents)).toBe(true);
  });

  it("returns an all-zero snapshot for an empty portfolio", () => {
    const snapshot = computeDailySnapshot([], "2026-08-04");
    expect(snapshot.totalValueCents).toBe(0);
    expect(snapshot.totalGainLossCents).toBe(0);
    expect(snapshot.positionCount).toBe(0);
  });

  it("counts positions, not tickers", () => {
    const snapshot = computeDailySnapshot(
      [makePosition({ accountId: 0 }), makePosition({ accountId: 7 })],
      "2026-08-04",
    );
    expect(snapshot.positionCount).toBe(2);
  });
});

describe("captureDailySnapshot", () => {
  const positions = [
    makePosition({ type: "Stock", currentPriceCents: 15000, quantity: 10, dayGainLossCents: 5000 }),
  ];

  it("inserts a row for a date with no snapshot yet", () => {
    const repo = fakeRepo();
    const saved = captureDailySnapshot(repo, positions, "2026-08-04");
    expect(saved.snapshotDate).toBe("2026-08-04");
    expect(saved.totalValueCents).toBe(150000);
    expect(listSnapshots(repo)).toHaveLength(1);
  });

  it("overwrites the same date instead of adding a second row", () => {
    const repo = fakeRepo();
    captureDailySnapshot(repo, positions, "2026-08-04");
    const updated = captureDailySnapshot(
      repo,
      [makePosition({ type: "Stock", currentPriceCents: 16000, quantity: 10, dayGainLossCents: 6000 })],
      "2026-08-04",
    );
    expect(listSnapshots(repo)).toHaveLength(1);
    expect(updated.totalValueCents).toBe(160000);
    expect(updated.totalGainLossCents).toBe(6000);
  });

  it("keeps a different date as its own row", () => {
    const repo = fakeRepo();
    captureDailySnapshot(repo, positions, "2026-08-04");
    captureDailySnapshot(repo, positions, "2026-08-05");
    expect(listSnapshots(repo).map((snapshot) => snapshot.snapshotDate)).toEqual([
      "2026-08-04",
      "2026-08-05",
    ]);
  });

  it("rejects a date that isn't YYYY-MM-DD", () => {
    const repo = fakeRepo();
    expect(() => captureDailySnapshot(repo, positions, "08/04/2026")).toThrow();
  });
});

describe("listSnapshots / getSnapshot / deleteSnapshot", () => {
  const seed = [
    makeSnapshot({ snapshotDate: "2026-08-03" }),
    makeSnapshot({ snapshotDate: "2026-08-04" }),
    makeSnapshot({ snapshotDate: "2026-08-05" }),
  ];

  it("filters to an inclusive date range", () => {
    const repo = fakeRepo(seed);
    const rows = listSnapshots(repo, { fromDate: "2026-08-03", toDate: "2026-08-04" });
    expect(rows.map((row) => row.snapshotDate)).toEqual(["2026-08-03", "2026-08-04"]);
  });

  it("rejects a range whose end precedes its start", () => {
    const repo = fakeRepo(seed);
    expect(() => listSnapshots(repo, { fromDate: "2026-08-05", toDate: "2026-08-03" })).toThrow();
  });

  it("reads and removes one date", () => {
    const repo = fakeRepo(seed);
    expect(getSnapshot(repo, "2026-08-04")?.snapshotDate).toBe("2026-08-04");
    deleteSnapshot(repo, "2026-08-04");
    expect(getSnapshot(repo, "2026-08-04")).toBeUndefined();
    expect(listSnapshots(repo)).toHaveLength(2);
  });
});

describe("summarizeSnapshotPeriod", () => {
  const week = [
    makeSnapshot({ snapshotDate: "2026-08-03", totalValueCents: 102000, totalGainLossCents: 2000 }),
    makeSnapshot({ snapshotDate: "2026-08-04", totalValueCents: 101000, totalGainLossCents: -1000 }),
    makeSnapshot({ snapshotDate: "2026-08-05", totalValueCents: 104000, totalGainLossCents: 3000 }),
  ];

  it("sums the daily moves and counts up/down days", () => {
    const summary = summarizeSnapshotPeriod(week);
    expect(summary.dayCount).toBe(3);
    expect(summary.gainLossCents).toBe(4000);
    expect(summary.upDays).toBe(2);
    expect(summary.downDays).toBe(1);
  });

  it("measures the starting value before the first day moved", () => {
    const summary = summarizeSnapshotPeriod(week);
    expect(summary.startValueCents).toBe(100000); // 102000 - 2000
    expect(summary.endValueCents).toBe(104000);
    expect(summary.valueChangeCents).toBe(4000);
    expect(summary.gainLossPct).toBeCloseTo(4, 5);
  });

  it("reports the best and worst day", () => {
    const summary = summarizeSnapshotPeriod(week);
    expect(summary.bestDay).toEqual({ snapshotDate: "2026-08-05", gainLossCents: 3000 });
    expect(summary.worstDay).toEqual({ snapshotDate: "2026-08-04", gainLossCents: -1000 });
  });

  it("sorts before summarizing, so input order doesn't matter", () => {
    const shuffled = [week[2], week[0], week[1]];
    expect(summarizeSnapshotPeriod(shuffled)).toEqual(summarizeSnapshotPeriod(week));
  });

  it("separates performance from a contribution, rather than counting it as a gain", () => {
    // Day two's value jumps $50,000 but the market only moved $1,000 — the rest was
    // money paid in. gainLossCents must not see the deposit; valueChange must.
    const withDeposit = [
      makeSnapshot({ snapshotDate: "2026-08-03", totalValueCents: 100000, totalGainLossCents: 0 }),
      makeSnapshot({ snapshotDate: "2026-08-04", totalValueCents: 5101000, totalGainLossCents: 1000 }),
    ];
    const summary = summarizeSnapshotPeriod(withDeposit);
    expect(summary.gainLossCents).toBe(1000);
    expect(summary.valueChangeCents).toBe(5001000);
  });

  it("returns zeros for an empty period without dividing by zero", () => {
    const summary = summarizeSnapshotPeriod([], "2026-08-03", "2026-08-09");
    expect(summary.dayCount).toBe(0);
    expect(summary.gainLossCents).toBe(0);
    expect(summary.gainLossPct).toBe(0);
    expect(summary.bestDay).toBeUndefined();
  });

  it("reports 0% rather than Infinity when the period started from nothing", () => {
    const summary = summarizeSnapshotPeriod([
      makeSnapshot({ snapshotDate: "2026-08-03", totalValueCents: 5000, totalGainLossCents: 5000 }),
    ]);
    expect(summary.startValueCents).toBe(0);
    expect(summary.gainLossPct).toBe(0);
  });

  it("counts only the days that have a snapshot, rather than filling a gap", () => {
    const withGap = [week[0], week[2]]; // 2026-08-04 never captured
    expect(summarizeSnapshotPeriod(withGap).dayCount).toBe(2);
  });
});

describe("summarizeToDate", () => {
  // 2026-08-04 is a Tuesday, so its week starts Monday 2026-08-03.
  const snapshots = [
    makeSnapshot({ snapshotDate: "2026-07-31", totalValueCents: 90000, totalGainLossCents: 500 }),
    makeSnapshot({ snapshotDate: "2026-08-03", totalValueCents: 102000, totalGainLossCents: 2000 }),
    makeSnapshot({ snapshotDate: "2026-08-04", totalValueCents: 104000, totalGainLossCents: 2000 }),
  ];

  it("scopes the week to Monday onward", () => {
    const { week } = summarizeToDate(snapshots, "2026-08-04");
    expect(week.fromDate).toBe("2026-08-03");
    expect(week.dayCount).toBe(2);
    expect(week.gainLossCents).toBe(4000);
  });

  it("scopes the month to the 1st, excluding the previous month", () => {
    const { month } = summarizeToDate(snapshots, "2026-08-04");
    expect(month.fromDate).toBe("2026-08-01");
    expect(month.dayCount).toBe(2); // 2026-07-31 excluded
    expect(month.gainLossCents).toBe(4000);
  });

  it("scopes the year to 1 January, including every month", () => {
    const { year } = summarizeToDate(snapshots, "2026-08-04");
    expect(year.fromDate).toBe("2026-01-01");
    expect(year.dayCount).toBe(3);
    expect(year.gainLossCents).toBe(4500);
  });

  it("excludes days after the as-of date", () => {
    const { year } = summarizeToDate(snapshots, "2026-08-03");
    expect(year.dayCount).toBe(2);
    expect(year.gainLossCents).toBe(2500);
  });

  it("returns empty summaries when nothing has been captured yet", () => {
    const { week, month, year } = summarizeToDate([], "2026-08-04");
    expect([week.dayCount, month.dayCount, year.dayCount]).toEqual([0, 0, 0]);
  });
});
