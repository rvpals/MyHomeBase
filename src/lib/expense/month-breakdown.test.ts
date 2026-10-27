import { describe, expect, it } from "vitest";
import { currentMonth, monthCategoryBreakdown, monthsPresent } from "./month-breakdown";
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

describe("monthCategoryBreakdown", () => {
  it("totals each category within the month, biggest spend first", () => {
    const rows = [
      transaction({ transactionDate: "2026-08-02", categoryName: "Dining", amountCents: 2_000 }),
      transaction({ transactionDate: "2026-08-14", categoryName: "Groceries", amountCents: 5_000 }),
      transaction({ transactionDate: "2026-08-20", categoryName: "Dining", amountCents: 1_500 }),
    ];

    const result = monthCategoryBreakdown(rows, "2026-08");

    expect(result.slices.map((slice) => slice.categoryName)).toEqual(["Groceries", "Dining"]);
    expect(result.slices[0].totalCents).toBe(5_000);
    expect(result.slices[1].totalCents).toBe(3_500);
    expect(result.slices[1].transactionCount).toBe(2);
    expect(result.netCents).toBe(8_500);
    expect(result.transactionCount).toBe(3);
  });

  it("labels the month", () => {
    expect(monthCategoryBreakdown([], "2026-08").label).toBe("Aug 2026");
  });

  it("ignores transactions outside the month", () => {
    const rows = [
      transaction({ transactionDate: "2026-08-31", categoryName: "Dining", amountCents: 1_000 }),
      transaction({ transactionDate: "2026-09-01", categoryName: "Dining", amountCents: 9_900 }),
      transaction({ transactionDate: "2026-07-31", categoryName: "Dining", amountCents: 8_800 }),
    ];

    const result = monthCategoryBreakdown(rows, "2026-08");

    expect(result.netCents).toBe(1_000);
    expect(result.transactionCount).toBe(1);
  });

  it("keeps uncategorised rows under an empty name", () => {
    const rows = [
      transaction({ transactionDate: "2026-08-02", categoryName: "", amountCents: 4_000 }),
      transaction({ transactionDate: "2026-08-03", categoryName: "Dining", amountCents: 1_000 }),
    ];

    const result = monthCategoryBreakdown(rows, "2026-08");

    expect(result.slices[0].categoryName).toBe("");
    expect(result.slices[0].totalCents).toBe(4_000);
    expect(result.biggest?.categoryName).toBe("");
  });

  it("shares the positive spend, so charted slices sum to one", () => {
    const rows = [
      transaction({ transactionDate: "2026-08-02", categoryName: "Groceries", amountCents: 7_500 }),
      transaction({ transactionDate: "2026-08-03", categoryName: "Dining", amountCents: 2_500 }),
    ];

    const result = monthCategoryBreakdown(rows, "2026-08");

    expect(result.spendCents).toBe(10_000);
    expect(result.slices[0].share).toBeCloseTo(0.75);
    expect(result.slices[1].share).toBeCloseTo(0.25);
    expect(result.slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1);
  });

  it("excludes a category in credit from the share but keeps its row", () => {
    const rows = [
      transaction({ transactionDate: "2026-08-02", categoryName: "Groceries", amountCents: 10_000 }),
      transaction({ transactionDate: "2026-08-03", categoryName: "Refunds", amountCents: -4_000 }),
    ];

    const result = monthCategoryBreakdown(rows, "2026-08");

    const refunds = result.slices.find((slice) => slice.categoryName === "Refunds");
    expect(refunds?.isSpend).toBe(false);
    expect(refunds?.share).toBe(0);
    // The whole the chart divides is the spend, not the net.
    expect(result.spendCents).toBe(10_000);
    expect(result.netCents).toBe(6_000);
    // Credits sort after spend, so the chartable rows lead the table.
    expect(result.slices[result.slices.length - 1].categoryName).toBe("Refunds");
  });

  it("names the biggest spending category", () => {
    const rows = [
      transaction({ transactionDate: "2026-08-02", categoryName: "Dining", amountCents: 2_000 }),
      transaction({ transactionDate: "2026-08-03", categoryName: "Groceries", amountCents: 6_000 }),
    ];

    expect(monthCategoryBreakdown(rows, "2026-08").biggest?.categoryName).toBe("Groceries");
  });

  it("has no biggest when the month is nothing but credits", () => {
    const rows = [
      transaction({ transactionDate: "2026-08-02", categoryName: "Refunds", amountCents: -4_000 }),
    ];

    const result = monthCategoryBreakdown(rows, "2026-08");

    expect(result.biggest).toBeUndefined();
    expect(result.spendCents).toBe(0);
    // No division by a zero whole.
    expect(result.slices[0].share).toBe(0);
  });

  it("returns an empty but labelled breakdown for a month with no rows", () => {
    const result = monthCategoryBreakdown([], "2026-02");

    expect(result.slices).toEqual([]);
    expect(result.netCents).toBe(0);
    expect(result.spendCents).toBe(0);
    expect(result.transactionCount).toBe(0);
    expect(result.biggest).toBeUndefined();
    expect(result.label).toBe("Feb 2026");
  });

  it("leaves out rows whose date can't be read", () => {
    const rows = [
      transaction({ transactionDate: "", categoryName: "Dining", amountCents: 9_900 }),
      transaction({ transactionDate: "not-a-date", categoryName: "Dining", amountCents: 8_800 }),
      transaction({ transactionDate: "2026-08-02", categoryName: "Dining", amountCents: 1_000 }),
    ];

    const result = monthCategoryBreakdown(rows, "2026-08");

    expect(result.transactionCount).toBe(1);
    expect(result.netCents).toBe(1_000);
  });
});

describe("monthsPresent", () => {
  it("lists the months that have rows, oldest first, without duplicates", () => {
    const rows = [
      transaction({ transactionDate: "2026-09-04" }),
      transaction({ transactionDate: "2026-07-11" }),
      transaction({ transactionDate: "2026-09-20" }),
    ];

    expect(monthsPresent(rows)).toEqual(["2026-07", "2026-09"]);
  });

  it("does not fill the gaps between them", () => {
    const rows = [
      transaction({ transactionDate: "2026-01-04" }),
      transaction({ transactionDate: "2026-06-04" }),
    ];

    expect(monthsPresent(rows)).toEqual(["2026-01", "2026-06"]);
  });

  it("skips unreadable dates and returns empty when nothing is dated", () => {
    expect(monthsPresent([transaction({ transactionDate: "" })])).toEqual([]);
    expect(monthsPresent([])).toEqual([]);
  });
});

describe("currentMonth", () => {
  it("reads the local year and month", () => {
    expect(currentMonth(new Date(2026, 7, 14, 12, 0, 0))).toBe("2026-08");
  });

  it("pads a single-digit month", () => {
    expect(currentMonth(new Date(2026, 0, 1, 12, 0, 0))).toBe("2026-01");
  });

  it("stays on the local month at the very start of it", () => {
    // Local midnight on the 1st. Via toISOString this would be the previous
    // month for any timezone west of Greenwich.
    expect(currentMonth(new Date(2026, 8, 1, 0, 30, 0))).toBe("2026-09");
  });
});
