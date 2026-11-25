import { describe, expect, it } from "vitest";
import type { TBillRepository } from "./ports";
import type { CreateTBillPurchaseInput, UpdateTBillPurchaseInput } from "./schema";
import { createTBillPurchaseSchema } from "./schema";
import {
  buildGainOverTime,
  computeStats,
  createPurchase,
  daysBetweenIso,
  deletePurchase,
  describePurchase,
  listPurchases,
  summarizePurchases,
  updatePurchase,
} from "./treasury-bills";
import type { TBillPurchase } from "./types";

/**
 * A hand-written in-memory repository, per ARCHITECTURE.md — a fake over a mocking
 * framework, so the tests read as data in / data out and don't couple to call order.
 */
function fakeRepo(seed: TBillPurchase[] = []): TBillRepository & { rows: TBillPurchase[] } {
  let nextId = seed.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  const rows = [...seed];

  return {
    rows,
    listPurchases: () =>
      [...rows].sort(
        (a, b) => b.datePurchased.localeCompare(a.datePurchased) || b.id - a.id,
      ),
    getPurchaseById: (id) => rows.find((row) => row.id === id),
    createPurchase: (input: CreateTBillPurchaseInput) => {
      const created: TBillPurchase = {
        ...input,
        id: nextId++,
        createdAt: "2026-01-01 00:00:00",
        updatedAt: "2026-01-01 00:00:00",
      };
      rows.push(created);
      return created;
    },
    updatePurchase: (id, input: UpdateTBillPurchaseInput) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index === -1) throw new Error(`No T-Bill purchase with id ${id}.`);
      rows[index] = { ...rows[index], ...input, updatedAt: "2026-02-02 00:00:00" };
      return rows[index];
    },
    deletePurchase: (id) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index !== -1) rows.splice(index, 1);
    },
    countsBySymbolAndDate: () => {
      const counts = new Map<string, number>();
      for (const row of rows) {
        const key = `${row.symbol.trim().toLowerCase()}\u0000${row.datePurchased}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return counts;
    },
  };
}

function purchase(overrides: Partial<TBillPurchase> = {}): TBillPurchase {
  return {
    id: 1,
    symbol: "912797LS4",
    description: "UNITED STATES TREAS BILLS ZERO CPN",
    datePurchased: "2026-01-05",
    datePayout: "2026-04-05",
    sharesPurchased: 100,
    purchasePrice: 98.75,
    amountSpentCents: 987_500,
    payoutAmountCents: 1_000_000,
    createdAt: "2026-01-05 10:00:00",
    updatedAt: "2026-01-05 10:00:00",
    ...overrides,
  };
}

describe("daysBetweenIso", () => {
  it("counts whole calendar days", () => {
    expect(daysBetweenIso("2026-01-05", "2026-04-05")).toBe(90);
    expect(daysBetweenIso("2026-01-01", "2026-01-02")).toBe(1);
    expect(daysBetweenIso("2026-01-01", "2026-01-01")).toBe(0);
  });

  it("crosses a DST boundary without losing or gaining a day", () => {
    // US spring forward 2026-03-08: the local day is 23 hours, which is exactly
    // what millisecond arithmetic over local midnights gets wrong.
    expect(daysBetweenIso("2026-03-07", "2026-03-09")).toBe(2);
    // And autumn back, 2026-11-01, where the local day is 25 hours.
    expect(daysBetweenIso("2026-10-31", "2026-11-02")).toBe(2);
  });

  it("counts across a leap day and a year boundary", () => {
    expect(daysBetweenIso("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetweenIso("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("rejects a date that is not real", () => {
    expect(() => daysBetweenIso("2026-02-31", "2026-03-01")).toThrow(/not a real date/);
  });
});

describe("describePurchase", () => {
  it("derives gain, gain %, days and yield", () => {
    const view = describePurchase(purchase());

    expect(view.gainAmountCents).toBe(12_500);
    expect(view.daysToMaturity).toBe(90);
    expect(view.gainPct).toBeCloseTo((12_500 / 987_500) * 100, 10);
    // (100 - 98.75) / 98.75 * 100 * 365 / 90
    expect(view.yieldPct).toBeCloseTo(((100 - 98.75) / 98.75) * 100 * (365 / 90), 10);
  });

  it("reports a loss as a negative gain rather than refusing it", () => {
    const view = describePurchase(
      purchase({ amountSpentCents: 1_000_000, payoutAmountCents: 990_000 }),
    );
    expect(view.gainAmountCents).toBe(-10_000);
    expect(view.gainPct).toBeCloseTo(-1, 10);
  });

  it("reads undefined, never 0, when there is nothing to divide by", () => {
    // A same-day maturity has no term to annualise over.
    const sameDay = describePurchase(purchase({ datePayout: "2026-01-05" }));
    expect(sameDay.daysToMaturity).toBe(0);
    expect(sameDay.yieldPct).toBeUndefined();

    // Nothing spent means no percentage return exists.
    const nothingSpent = describePurchase(purchase({ amountSpentCents: 0 }));
    expect(nothingSpent.gainPct).toBeUndefined();

    const noPrice = describePurchase(purchase({ purchasePrice: 0 }));
    expect(noPrice.yieldPct).toBeUndefined();
  });

  it("gives a bill bought at par a zero yield, which is a real reading", () => {
    const atPar = describePurchase(purchase({ purchasePrice: 100 }));
    expect(atPar.yieldPct).toBe(0);
  });
});

describe("buildGainOverTime", () => {
  it("accumulates by payout date, oldest first", () => {
    const points = buildGainOverTime(
      [
        purchase({ id: 1, datePayout: "2026-04-05", amountSpentCents: 100, payoutAmountCents: 200 }),
        purchase({ id: 2, datePayout: "2026-02-05", amountSpentCents: 100, payoutAmountCents: 150 }),
      ].map(describePurchase),
    );

    expect(points.map((point) => point.date)).toEqual(["2026-02-05", "2026-04-05"]);
    expect(points.map((point) => point.cumulativeGainCents)).toEqual([50, 150]);
    expect(points.map((point) => point.maturedCount)).toEqual([1, 2]);
  });

  it("collapses bills maturing on the same date into one point", () => {
    const points = buildGainOverTime(
      [
        purchase({ id: 1, datePayout: "2026-04-05", amountSpentCents: 100, payoutAmountCents: 200 }),
        purchase({ id: 2, datePayout: "2026-04-05", amountSpentCents: 100, payoutAmountCents: 300 }),
      ].map(describePurchase),
    );

    expect(points).toHaveLength(1);
    expect(points[0].cumulativeGainCents).toBe(300);
    expect(points[0].maturedCount).toBe(2);
  });

  it("orders by payout, not by purchase", () => {
    // Bought first, matures last — the line must not credit it early.
    const points = buildGainOverTime(
      [
        purchase({
          id: 1,
          datePurchased: "2026-01-01",
          datePayout: "2026-12-01",
          amountSpentCents: 100,
          payoutAmountCents: 1_100,
        }),
        purchase({
          id: 2,
          datePurchased: "2026-06-01",
          datePayout: "2026-07-01",
          amountSpentCents: 100,
          payoutAmountCents: 200,
        }),
      ].map(describePurchase),
    );

    expect(points.map((point) => point.date)).toEqual(["2026-07-01", "2026-12-01"]);
    expect(points.map((point) => point.cumulativeGainCents)).toEqual([100, 1_100]);
  });

  it("returns nothing for no purchases", () => {
    expect(buildGainOverTime([])).toEqual([]);
  });

  it("can go down, when a matured bill lost money", () => {
    const points = buildGainOverTime(
      [
        purchase({ id: 1, datePayout: "2026-02-01", amountSpentCents: 100, payoutAmountCents: 300 }),
        purchase({ id: 2, datePayout: "2026-03-01", amountSpentCents: 500, payoutAmountCents: 400 }),
      ].map(describePurchase),
    );
    expect(points.map((point) => point.cumulativeGainCents)).toEqual([200, 100]);
  });
});

describe("computeStats", () => {
  it("totals, returns and plain unweighted averages", () => {
    const rows = [
      purchase({ id: 1, amountSpentCents: 980_000, payoutAmountCents: 1_000_000 }),
      purchase({ id: 2, amountSpentCents: 490_000, payoutAmountCents: 500_000 }),
    ].map(describePurchase);

    const stats = computeStats(rows);

    expect(stats.purchaseCount).toBe(2);
    expect(stats.totalInvestedCents).toBe(1_470_000);
    expect(stats.totalGainedCents).toBe(30_000);
    expect(stats.totalReturnPct).toBeCloseTo((30_000 / 1_470_000) * 100, 10);
    expect(stats.averageGainCents).toBe(15_000);
    // Unweighted: the mean of the two yields, not weighted by what was invested.
    const expectedYield =
      (rows[0].yieldPct! + rows[1].yieldPct!) / 2;
    expect(stats.averageYieldPct).toBeCloseTo(expectedYield, 10);
  });

  it("averages yield over the rows that have one, not over every row", () => {
    const rows = [
      // No term, so no yield — it must not drag the mean toward zero.
      purchase({ id: 1, datePayout: "2026-01-05", purchasePrice: 99 }),
      purchase({ id: 2, datePurchased: "2026-01-05", datePayout: "2026-04-05", purchasePrice: 99 }),
    ].map(describePurchase);

    const stats = computeStats(rows);
    expect(rows[0].yieldPct).toBeUndefined();
    expect(stats.averageYieldPct).toBeCloseTo(rows[1].yieldPct!, 10);
  });

  it("reports undefined rather than zero for an empty set", () => {
    const stats = computeStats([]);

    expect(stats.purchaseCount).toBe(0);
    expect(stats.totalInvestedCents).toBe(0);
    expect(stats.totalGainedCents).toBe(0);
    expect(stats.totalReturnPct).toBeUndefined();
    expect(stats.averageYieldPct).toBeUndefined();
    expect(stats.averageGainCents).toBeUndefined();
    expect(stats.gainOverTime).toEqual([]);
  });

  it("carries the chart series", () => {
    const stats = computeStats([purchase()].map(describePurchase));
    expect(stats.gainOverTime).toEqual([
      { date: "2026-04-05", cumulativeGainCents: 12_500, maturedCount: 1 },
    ]);
  });
});

describe("the schema", () => {
  const valid = {
    symbol: "912797LS4",
    description: "",
    datePurchased: "2026-01-05",
    datePayout: "2026-04-05",
    sharesPurchased: 100,
    purchasePrice: 98.75,
    amountSpentCents: 987_500,
    payoutAmountCents: 1_000_000,
  };

  it("accepts a well-formed purchase", () => {
    expect(() => createTBillPurchaseSchema.parse(valid)).not.toThrow();
  });

  it("refuses a price above par, which the yield formula cannot mean", () => {
    expect(() => createTBillPurchaseSchema.parse({ ...valid, purchasePrice: 100.5 })).toThrow(
      /per \$100 of face value/,
    );
  });

  it("refuses a missing symbol, a bad date and a payout before the purchase", () => {
    expect(() => createTBillPurchaseSchema.parse({ ...valid, symbol: "" })).toThrow(/symbol/i);
    expect(() => createTBillPurchaseSchema.parse({ ...valid, datePurchased: "05/01/2026" })).toThrow(
      /YYYY-MM-DD/,
    );
    expect(() =>
      createTBillPurchaseSchema.parse({ ...valid, datePayout: "2026-01-04" }),
    ).toThrow(/cannot be before the purchase date/);
  });

  it("allows a same-day maturity, which is odd but not invalid", () => {
    expect(() =>
      createTBillPurchaseSchema.parse({ ...valid, datePayout: valid.datePurchased }),
    ).not.toThrow();
  });
});

describe("the use-cases", () => {
  it("creates, lists newest first, and derives on the way out", () => {
    const repo = fakeRepo();
    createPurchase(repo, {
      symbol: "AAA",
      description: "",
      datePurchased: "2026-01-05",
      datePayout: "2026-04-05",
      sharesPurchased: 100,
      purchasePrice: 98.75,
      amountSpentCents: 987_500,
      payoutAmountCents: 1_000_000,
    });
    createPurchase(repo, {
      symbol: "BBB",
      description: "",
      datePurchased: "2026-03-05",
      datePayout: "2026-06-05",
      sharesPurchased: 50,
      purchasePrice: 99,
      amountSpentCents: 495_000,
      payoutAmountCents: 500_000,
    });

    const rows = listPurchases(repo);
    expect(rows.map((row) => row.symbol)).toEqual(["BBB", "AAA"]);
    expect(rows[1].gainAmountCents).toBe(12_500);
    expect(rows[1].daysToMaturity).toBe(90);
  });

  it("refuses to create a purchase the schema rejects", () => {
    const repo = fakeRepo();
    expect(() =>
      createPurchase(repo, {
        symbol: "AAA",
        description: "",
        datePurchased: "2026-04-05",
        datePayout: "2026-01-05",
        sharesPurchased: 1,
        purchasePrice: 99,
        amountSpentCents: 1,
        payoutAmountCents: 1,
      }),
    ).toThrow(/cannot be before the purchase date/);
    expect(repo.rows).toHaveLength(0);
  });

  it("updates an existing purchase", () => {
    const repo = fakeRepo([purchase({ id: 7 })]);
    const updated = updatePurchase(repo, 7, {
      symbol: "CCC",
      description: "edited",
      datePurchased: "2026-01-05",
      datePayout: "2026-07-05",
      sharesPurchased: 100,
      purchasePrice: 98,
      amountSpentCents: 980_000,
      payoutAmountCents: 1_000_000,
    });

    expect(updated.symbol).toBe("CCC");
    expect(updated.gainAmountCents).toBe(20_000);
    expect(updated.daysToMaturity).toBe(181);
  });

  it("names the id when updating or deleting one that is not there", () => {
    const repo = fakeRepo();
    expect(() =>
      updatePurchase(repo, 99, {
        symbol: "AAA",
        description: "",
        datePurchased: "2026-01-05",
        datePayout: "2026-04-05",
        sharesPurchased: 1,
        purchasePrice: 99,
        amountSpentCents: 1,
        payoutAmountCents: 1,
      }),
    ).toThrow(/No T-Bill purchase with id 99/);
    expect(() => deletePurchase(repo, 99)).toThrow(/No T-Bill purchase with id 99/);
  });

  it("deletes one it does have", () => {
    const repo = fakeRepo([purchase({ id: 3 })]);
    deletePurchase(repo, 3);
    expect(repo.rows).toHaveLength(0);
  });

  it("summarizes straight from the repository", () => {
    const repo = fakeRepo([
      purchase({ id: 1, amountSpentCents: 980_000, payoutAmountCents: 1_000_000 }),
    ]);
    expect(summarizePurchases(repo).totalGainedCents).toBe(20_000);
  });
});
