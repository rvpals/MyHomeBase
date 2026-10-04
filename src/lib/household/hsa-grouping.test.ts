import { describe, expect, it } from "vitest";
import { UNDATED_YEAR_LABEL, groupHsaExpensesByYear, yearOf } from "./hsa-grouping";
import type { HsaExpense } from "./hsa-types";

let nextId = 1;

function expense(over: Partial<HsaExpense> = {}): HsaExpense {
  return {
    id: nextId++,
    entryDate: "2026-10-03",
    entryTime: "14:30",
    amountCents: 1000,
    productService: "Prescription",
    type: "Pharmacy",
    payee: "CVS",
    serviceDate: null,
    paidWith: "",
    note: "",
    isReimbursed: false,
    hasReceipt: false,
    receiptPath: "",
    receiptFileName: "",
    receiptMimeType: "",
    createdAt: "now",
    updatedAt: "now",
    ...over,
  };
}

describe("yearOf", () => {
  it("reads the year off the stored date", () => {
    expect(yearOf(expense({ entryDate: "2024-01-01" }))).toBe("2024");
  });

  it("does not shift a 1 January date into the previous year", () => {
    // The bug a `new Date(...)` would introduce west of UTC.
    expect(yearOf(expense({ entryDate: "2026-01-01" }))).toBe("2026");
  });

  it("labels an unreadable date rather than inventing a year", () => {
    expect(yearOf(expense({ entryDate: "" }))).toBe(UNDATED_YEAR_LABEL);
    expect(yearOf(expense({ entryDate: "not-a-date" }))).toBe(UNDATED_YEAR_LABEL);
  });
});

describe("groupHsaExpensesByYear", () => {
  it("returns nothing for no expenses", () => {
    expect(groupHsaExpensesByYear([])).toEqual([]);
  });

  it("groups by year, latest first", () => {
    const groups = groupHsaExpensesByYear([
      expense({ entryDate: "2024-05-01" }),
      expense({ entryDate: "2026-02-01" }),
      expense({ entryDate: "2025-07-01" }),
      expense({ entryDate: "2026-09-01" }),
    ]);
    expect(groups.map((group) => group.key)).toEqual(["2026", "2025", "2024"]);
    expect(groups[0].expenseCount).toBe(2);
  });

  it("orders each year's rows newest first, by date then time", () => {
    const groups = groupHsaExpensesByYear([
      expense({ entryDate: "2026-03-01", entryTime: "09:00" }),
      expense({ entryDate: "2026-03-01", entryTime: "17:00" }),
      expense({ entryDate: "2026-08-01", entryTime: "08:00" }),
    ]);
    expect(groups[0].rows.map((row) => `${row.entryDate} ${row.entryTime}`)).toEqual([
      "2026-08-01 08:00",
      "2026-03-01 17:00",
      "2026-03-01 09:00",
    ]);
  });

  it("totals the year, and the unreimbursed part of it", () => {
    const [group] = groupHsaExpensesByYear([
      expense({ amountCents: 4250, isReimbursed: false }),
      expense({ amountCents: 1000, isReimbursed: true }),
      expense({ amountCents: 250, isReimbursed: false }),
    ]);
    expect(group.totalCents).toBe(5500);
    expect(group.unreimbursedCents).toBe(4500);
  });

  it("counts the receipts in a year", () => {
    const [group] = groupHsaExpensesByYear([
      expense({ hasReceipt: true }),
      expense({ hasReceipt: false }),
      expense({ hasReceipt: true }),
    ]);
    expect(group.receiptCount).toBe(2);
    expect(group.expenseCount).toBe(3);
  });

  it("keeps undated rows, and sorts them last", () => {
    const groups = groupHsaExpensesByYear([
      expense({ entryDate: "" }),
      expense({ entryDate: "2019-01-01" }),
      expense({ entryDate: "2026-01-01" }),
    ]);
    expect(groups.map((group) => group.key)).toEqual(["2026", "2019", UNDATED_YEAR_LABEL]);
  });

  it("does not mutate the array it was given", () => {
    const rows = [expense({ entryDate: "2024-01-01" }), expense({ entryDate: "2026-01-01" })];
    const before = rows.map((row) => row.id);
    groupHsaExpensesByYear(rows);
    expect(rows.map((row) => row.id)).toEqual(before);
  });
});
