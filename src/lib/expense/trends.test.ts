import { describe, expect, it } from "vitest";
import {
  compareMonths,
  categoryTotalsForMonth,
  latestMonth,
  monthLabel,
  monthOf,
  monthRange,
  monthlyTotals,
  previousMonthOf,
} from "./trends";
import type { ExpenseTransaction } from "./types";

function transaction(overrides: Partial<ExpenseTransaction> = {}): ExpenseTransaction {
  return {
    id: 1,
    transactionDate: "2026-08-01",
    postingDate: "",
    transactionAccountId: 1,
    transactionDescription: "",
    categoryName: "",
    vendor: "",
    amountCents: 0,
    note: "",
    status: "new",
    processed: false,
    createdByUserId: 1,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("monthOf", () => {
  it("reads the period out of a date", () => {
    expect(monthOf("2026-08-14")).toBe("2026-08");
  });

  it("ignores surrounding whitespace", () => {
    expect(monthOf("  2026-08-14  ")).toBe("2026-08");
  });

  it("returns undefined for a blank or malformed date", () => {
    expect(monthOf("")).toBeUndefined();
    expect(monthOf("14/08/2026")).toBeUndefined();
    expect(monthOf("2026-08")).toBeUndefined();
  });

  it("returns undefined for a month outside 1–12", () => {
    expect(monthOf("2026-13-01")).toBeUndefined();
    expect(monthOf("2026-00-01")).toBeUndefined();
  });
});

describe("monthLabel", () => {
  it("names the month and year", () => {
    expect(monthLabel("2026-08")).toBe("Aug 2026");
    expect(monthLabel("2026-01")).toBe("Jan 2026");
    expect(monthLabel("2026-12")).toBe("Dec 2026");
  });

  it("hands back anything that isn't a period unchanged", () => {
    expect(monthLabel("nonsense")).toBe("nonsense");
    expect(monthLabel("2026-13")).toBe("2026-13");
  });
});

describe("previousMonthOf", () => {
  it("steps back one month", () => {
    expect(previousMonthOf("2026-08")).toBe("2026-07");
  });

  it("rolls the year over at January", () => {
    expect(previousMonthOf("2026-01")).toBe("2025-12");
  });

  it("returns undefined for a value that isn't a period", () => {
    expect(previousMonthOf("2026-08-01")).toBeUndefined();
    expect(previousMonthOf("2026-13")).toBeUndefined();
  });
});

describe("monthRange", () => {
  it("lists every month between the bounds, inclusive", () => {
    expect(monthRange("2026-06", "2026-09")).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
  });

  it("crosses a year boundary", () => {
    expect(monthRange("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("returns the single month when both bounds are equal", () => {
    expect(monthRange("2026-08", "2026-08")).toEqual(["2026-08"]);
  });

  it("returns nothing when the range runs backwards", () => {
    expect(monthRange("2026-09", "2026-06")).toEqual([]);
  });

  it("returns nothing for a malformed bound", () => {
    expect(monthRange("nope", "2026-06")).toEqual([]);
  });
});

describe("monthlyTotals", () => {
  it("nets each month and orders them oldest first", () => {
    const totals = monthlyTotals([
      transaction({ id: 1, transactionDate: "2026-08-02", amountCents: 1000 }),
      transaction({ id: 2, transactionDate: "2026-08-20", amountCents: 500 }),
      transaction({ id: 3, transactionDate: "2026-07-14", amountCents: 2000 }),
    ]);

    expect(totals.map((total) => total.month)).toEqual(["2026-07", "2026-08"]);
    expect(totals[1]).toMatchObject({ totalCents: 1500, transactionCount: 2, label: "Aug 2026" });
  });

  it("nets a refund against the month rather than ignoring it", () => {
    const totals = monthlyTotals([
      transaction({ id: 1, transactionDate: "2026-08-02", amountCents: 1000 }),
      transaction({ id: 2, transactionDate: "2026-08-09", amountCents: -400 }),
    ]);

    expect(totals[0].totalCents).toBe(600);
    expect(totals[0].transactionCount).toBe(2);
  });

  it("fills a gap month with a zero so the axis stays continuous", () => {
    const totals = monthlyTotals([
      transaction({ id: 1, transactionDate: "2026-06-02", amountCents: 1000 }),
      transaction({ id: 2, transactionDate: "2026-08-02", amountCents: 1000 }),
    ]);

    expect(totals.map((total) => total.month)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(totals[1]).toMatchObject({ totalCents: 0, transactionCount: 0 });
  });

  it("keeps only the most recent months when over the limit", () => {
    const rows = [
      transaction({ id: 1, transactionDate: "2026-01-05", amountCents: 100 }),
      transaction({ id: 2, transactionDate: "2026-02-05", amountCents: 100 }),
      transaction({ id: 3, transactionDate: "2026-03-05", amountCents: 100 }),
    ];

    expect(monthlyTotals(rows, 2).map((total) => total.month)).toEqual(["2026-02", "2026-03"]);
  });

  it("counts the filled months against the limit, not just the ones with spend", () => {
    const totals = monthlyTotals(
      [
        transaction({ id: 1, transactionDate: "2026-01-05", amountCents: 100 }),
        transaction({ id: 2, transactionDate: "2026-04-05", amountCents: 100 }),
      ],
      2,
    );

    expect(totals.map((total) => total.month)).toEqual(["2026-03", "2026-04"]);
  });

  it("leaves out a row whose date can't be read rather than inventing a month", () => {
    const totals = monthlyTotals([
      transaction({ id: 1, transactionDate: "2026-08-02", amountCents: 1000 }),
      transaction({ id: 2, transactionDate: "", amountCents: 9999 }),
    ]);

    expect(totals).toHaveLength(1);
    expect(totals[0].totalCents).toBe(1000);
  });

  it("returns nothing when there are no dated transactions", () => {
    expect(monthlyTotals([])).toEqual([]);
    expect(monthlyTotals([transaction({ transactionDate: "bad" })])).toEqual([]);
  });
});

describe("categoryTotalsForMonth", () => {
  it("nets each category within the month and ignores other months", () => {
    const totals = categoryTotalsForMonth(
      [
        transaction({ id: 1, transactionDate: "2026-08-02", categoryName: "Gas", amountCents: 1000 }),
        transaction({ id: 2, transactionDate: "2026-08-20", categoryName: "Gas", amountCents: 500 }),
        transaction({ id: 3, transactionDate: "2026-07-02", categoryName: "Gas", amountCents: 9999 }),
      ],
      "2026-08",
    );

    expect(totals.get("Gas")).toBe(1500);
  });

  it("keeps uncategorised rows under the empty name", () => {
    const totals = categoryTotalsForMonth(
      [transaction({ transactionDate: "2026-08-02", categoryName: "", amountCents: 700 })],
      "2026-08",
    );

    expect(totals.get("")).toBe(700);
  });
});

describe("compareMonths", () => {
  const rows = [
    transaction({ id: 1, transactionDate: "2026-08-02", categoryName: "Gas", amountCents: 1500 }),
    transaction({ id: 2, transactionDate: "2026-07-02", categoryName: "Gas", amountCents: 1000 }),
    transaction({ id: 3, transactionDate: "2026-08-05", categoryName: "Food", amountCents: 200 }),
    transaction({ id: 4, transactionDate: "2026-07-05", categoryName: "Food", amountCents: 200 }),
  ];

  it("reports the change per category", () => {
    const gas = compareMonths(rows, "2026-08", "2026-07").find(
      (row) => row.categoryName === "Gas",
    );

    expect(gas).toMatchObject({ currentCents: 1500, previousCents: 1000, changeCents: 500 });
    expect(gas?.changeRatio).toBeCloseTo(0.5);
  });

  it("orders by the size of the change, not by spend", () => {
    const ordered = compareMonths(rows, "2026-08", "2026-07").map((row) => row.categoryName);

    // Food is unchanged, so it sorts below Gas despite both being present.
    expect(ordered[0]).toBe("Gas");
  });

  it("gives a category that only appears this month a zero baseline", () => {
    const started = compareMonths(
      [transaction({ transactionDate: "2026-08-02", categoryName: "New", amountCents: 900 })],
      "2026-08",
      "2026-07",
    );

    expect(started[0]).toMatchObject({
      categoryName: "New",
      currentCents: 900,
      previousCents: 0,
      changeCents: 900,
    });
  });

  it("gives a category that stopped a row too, rather than dropping it", () => {
    const stopped = compareMonths(
      [transaction({ transactionDate: "2026-07-02", categoryName: "Old", amountCents: 900 })],
      "2026-08",
      "2026-07",
    );

    expect(stopped[0]).toMatchObject({
      categoryName: "Old",
      currentCents: 0,
      previousCents: 900,
      changeCents: -900,
    });
  });

  it("has no ratio when the previous month was zero", () => {
    const started = compareMonths(
      [transaction({ transactionDate: "2026-08-02", categoryName: "New", amountCents: 900 })],
      "2026-08",
      "2026-07",
    );

    expect(started[0].changeRatio).toBeUndefined();
  });

  it("reads a ratio off a negative baseline by magnitude, so the sign follows the change", () => {
    // Previous month was a net refund. Spending this month is an increase, and
    // the ratio must not flip sign because the base was below zero.
    const rows = [
      transaction({ id: 1, transactionDate: "2026-07-02", categoryName: "Gear", amountCents: -1000 }),
      transaction({ id: 2, transactionDate: "2026-08-02", categoryName: "Gear", amountCents: 1000 }),
    ];

    const gear = compareMonths(rows, "2026-08", "2026-07")[0];
    expect(gear.changeCents).toBe(2000);
    expect(gear.changeRatio).toBeCloseTo(2);
  });

  it("returns nothing when neither month has transactions", () => {
    expect(compareMonths([], "2026-08", "2026-07")).toEqual([]);
  });
});

describe("latestMonth", () => {
  it("finds the most recent month present", () => {
    expect(
      latestMonth([
        transaction({ id: 1, transactionDate: "2026-07-02" }),
        transaction({ id: 2, transactionDate: "2026-08-02" }),
        transaction({ id: 3, transactionDate: "2026-06-02" }),
      ]),
    ).toBe("2026-08");
  });

  it("ignores rows whose date can't be read", () => {
    expect(
      latestMonth([
        transaction({ id: 1, transactionDate: "2026-07-02" }),
        transaction({ id: 2, transactionDate: "" }),
      ]),
    ).toBe("2026-07");
  });

  it("returns undefined when nothing is dated", () => {
    expect(latestMonth([])).toBeUndefined();
    expect(latestMonth([transaction({ transactionDate: "bad" })])).toBeUndefined();
  });
});
