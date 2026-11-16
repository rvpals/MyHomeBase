import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPENSE_DATE_WINDOW_DAYS,
  MAX_EXPENSE_DATE_WINDOW_DAYS,
  buildExpensesOnDateView,
  resolveExpenseDateWindow,
  transactionsInDateWindow,
} from "./expenses-on-date";
import type { CreditCardAccount, ExpenseTransaction } from "./types";

function transaction(overrides: Partial<ExpenseTransaction> = {}): ExpenseTransaction {
  return {
    id: 1,
    transactionDate: "2026-11-16",
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
    createdAt: "2026-11-16T00:00:00.000Z",
    updatedAt: "2026-11-16T00:00:00.000Z",
    ...overrides,
  };
}

function account(overrides: Partial<CreditCardAccount> = {}): CreditCardAccount {
  return {
    id: 1,
    name: "Visa Gold",
    description: "",
    creditLineCents: 0,
    statementCloseDay: 28,
    createdAt: "2026-11-16T00:00:00.000Z",
    updatedAt: "2026-11-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("resolveExpenseDateWindow", () => {
  it("defaults to one day either side", () => {
    expect(resolveExpenseDateWindow("2026-11-16")).toEqual({
      date: "2026-11-16",
      days: DEFAULT_EXPENSE_DATE_WINDOW_DAYS,
      from: "2026-11-15",
      to: "2026-11-17",
    });
  });

  it("collapses to the single day when asked for zero", () => {
    expect(resolveExpenseDateWindow("2026-11-16", 0)).toMatchObject({
      days: 0,
      from: "2026-11-16",
      to: "2026-11-16",
    });
  });

  it("widens symmetrically and crosses a month boundary", () => {
    expect(resolveExpenseDateWindow("2026-12-01", 3)).toMatchObject({
      from: "2026-11-28",
      to: "2026-12-04",
    });
  });

  it("clamps a negative width to zero rather than inverting the bounds", () => {
    expect(resolveExpenseDateWindow("2026-11-16", -5)).toMatchObject({
      days: 0,
      from: "2026-11-16",
      to: "2026-11-16",
    });
  });

  it("clamps an absurd width to the maximum", () => {
    const window = resolveExpenseDateWindow("2026-11-16", 9999);
    expect(window.days).toBe(MAX_EXPENSE_DATE_WINDOW_DAYS);
    expect(window.from).toBe("2026-10-16");
    expect(window.to).toBe("2026-12-17");
  });

  it("truncates a fractional width instead of throwing", () => {
    expect(resolveExpenseDateWindow("2026-11-16", 2.9).days).toBe(2);
  });

  it("falls back to the default width when handed NaN", () => {
    expect(resolveExpenseDateWindow("2026-11-16", Number.NaN).days).toBe(
      DEFAULT_EXPENSE_DATE_WINDOW_DAYS,
    );
  });

  it("rejects a malformed date", () => {
    expect(() => resolveExpenseDateWindow("16/11/2026")).toThrow(/YYYY-MM-DD/);
  });

  it("rejects a well-formed but impossible date", () => {
    expect(() => resolveExpenseDateWindow("2026-02-31")).toThrow(/not a real date/);
  });
});

describe("transactionsInDateWindow", () => {
  const window = resolveExpenseDateWindow("2026-11-16", 1);

  it("includes both bounds", () => {
    const rows = [
      transaction({ id: 1, transactionDate: "2026-11-15" }),
      transaction({ id: 2, transactionDate: "2026-11-17" }),
    ];
    expect(transactionsInDateWindow(rows, window).map((row) => row.id)).toEqual([1, 2]);
  });

  it("excludes the days just outside", () => {
    const rows = [
      transaction({ id: 1, transactionDate: "2026-11-14" }),
      transaction({ id: 2, transactionDate: "2026-11-16" }),
      transaction({ id: 3, transactionDate: "2026-11-18" }),
    ];
    expect(transactionsInDateWindow(rows, window).map((row) => row.id)).toEqual([2]);
  });

  it("returns nothing for an empty list", () => {
    expect(transactionsInDateWindow([], window)).toEqual([]);
  });
});

describe("buildExpensesOnDateView", () => {
  it("flattens rows, names the card and totals the amounts", () => {
    const view = buildExpensesOnDateView(
      [
        transaction({
          id: 7,
          transactionDate: "2026-11-16",
          transactionDescription: "SQ *TGI FRID 0042",
          vendor: "TGI Fridays",
          categoryName: "Dining",
          amountCents: 4250,
        }),
      ],
      [account({ id: 1, name: "Visa Gold" })],
      resolveExpenseDateWindow("2026-11-16", 1),
    );

    expect(view.rows).toEqual([
      {
        id: 7,
        date: "2026-11-16",
        vendor: "TGI Fridays",
        description: "SQ *TGI FRID 0042",
        categoryName: "Dining",
        accountName: "Visa Gold",
        amountCents: 4250,
      },
    ]);
    expect(view.totalCents).toBe(4250);
    expect(view.window.date).toBe("2026-11-16");
  });

  it("falls back to the raw statement text when no vendor has been derived", () => {
    const view = buildExpensesOnDateView(
      [transaction({ transactionDescription: "AMZN MKTP US*2H48", vendor: "" })],
      [account()],
      resolveExpenseDateWindow("2026-11-16", 0),
    );
    expect(view.rows[0].vendor).toBe("AMZN MKTP US*2H48");
  });

  it("sorts by date, then by biggest charge, then by id", () => {
    const view = buildExpensesOnDateView(
      [
        transaction({ id: 3, transactionDate: "2026-11-17", amountCents: 100 }),
        transaction({ id: 1, transactionDate: "2026-11-15", amountCents: 100 }),
        transaction({ id: 2, transactionDate: "2026-11-15", amountCents: 900 }),
      ],
      [account()],
      resolveExpenseDateWindow("2026-11-16", 1),
    );
    expect(view.rows.map((row) => row.id)).toEqual([2, 1, 3]);
  });

  it("keeps a row whose account has been deleted, with a blank card name", () => {
    const view = buildExpensesOnDateView(
      [transaction({ transactionAccountId: 99, amountCents: 1500 })],
      [account({ id: 1 })],
      resolveExpenseDateWindow("2026-11-16", 0),
    );
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].accountName).toBe("");
    // The money was still spent — dropping the row would make the total lie.
    expect(view.totalCents).toBe(1500);
  });

  it("nets a refund against the charges", () => {
    const view = buildExpensesOnDateView(
      [
        transaction({ id: 1, amountCents: 5000 }),
        transaction({ id: 2, amountCents: -2000 }),
      ],
      [account()],
      resolveExpenseDateWindow("2026-11-16", 0),
    );
    expect(view.totalCents).toBe(3000);
  });

  it("returns an empty view when nothing falls in the window", () => {
    const view = buildExpensesOnDateView(
      [transaction({ transactionDate: "2026-01-01" })],
      [account()],
      resolveExpenseDateWindow("2026-11-16", 1),
    );
    expect(view.rows).toEqual([]);
    expect(view.totalCents).toBe(0);
  });
});
