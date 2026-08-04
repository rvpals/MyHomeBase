import { describe, expect, it } from "vitest";
import type { ExpenseRepository, TransactionFilter } from "./ports";
import type { ExpenseTransaction } from "./types";
import { totalsByVendor, vendorGroupKey, vendorKeyFromDescription, vendorTotals } from "./vendors";

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

// totalsByVendor only reads transactions, so the fake implements just that and
// the date bounds it forwards.
function fakeRepo(transactions: ExpenseTransaction[]): ExpenseRepository {
  return {
    listTransactions: (filter?: TransactionFilter) =>
      transactions.filter((row) => {
        if (filter?.fromDate !== undefined && row.transactionDate < filter.fromDate) return false;
        if (filter?.toDate !== undefined && row.transactionDate > filter.toDate) return false;
        return true;
      }),
  } as unknown as ExpenseRepository;
}

describe("vendorKeyFromDescription", () => {
  it("takes the leading brand word, dropping store numbers and locations", () => {
    expect(vendorKeyFromDescription("COSTCO WHSE #1017 SEATTLE WA")).toBe("COSTCO");
    expect(vendorKeyFromDescription("COSTCO GAS #1017")).toBe("COSTCO");
  });

  it("upper-cases and cuts at the order reference", () => {
    expect(vendorKeyFromDescription("amazon.com*2A34B5C6")).toBe("AMAZON");
    expect(vendorKeyFromDescription("AMZN MKTP US*1D9EF")).toBe("AMZN");
  });

  it("strips a payment-processor prefix", () => {
    expect(vendorKeyFromDescription("SQ *BLUE BOTTLE COFFEE")).toBe("BLUE");
    expect(vendorKeyFromDescription("TST* WILLOWS INN")).toBe("WILLOWS");
  });

  it("skips leading filler words", () => {
    expect(vendorKeyFromDescription("THE HOME DEPOT 4501")).toBe("HOME");
  });

  it("keeps a digits-only opener attached to the first real word", () => {
    expect(vendorKeyFromDescription("7 ELEVEN #22188")).toBe("7 ELEVEN");
  });

  it("returns empty when there is no brand to find", () => {
    expect(vendorKeyFromDescription("")).toBe("");
    expect(vendorKeyFromDescription("   ")).toBe("");
    expect(vendorKeyFromDescription("#4451 0099")).toBe("");
  });
});

describe("vendorGroupKey", () => {
  it("prefers the tidied vendor, upper-cased", () => {
    expect(vendorGroupKey(transaction({ vendor: "Costco", transactionDescription: "WHATEVER 12" }))).toBe(
      "COSTCO",
    );
  });

  it("falls back to the description when the vendor is blank", () => {
    expect(vendorGroupKey(transaction({ vendor: "  ", transactionDescription: "COSTCO GAS #1017" }))).toBe(
      "COSTCO",
    );
  });
});

describe("vendorTotals", () => {
  it("sums fuzzy-matched descriptions into one group, biggest first", () => {
    const totals = vendorTotals([
      transaction({ id: 1, transactionDescription: "COSTCO WHSE #1017 SEATTLE WA", amountCents: 12_000 }),
      transaction({ id: 2, transactionDescription: "COSTCO GAS #1017", amountCents: 6_000 }),
      transaction({ id: 3, transactionDescription: "AMAZON.COM*2A34B5C6", amountCents: 9_500 }),
    ]);

    expect(totals).toEqual([
      { vendor: "COSTCO", totalCents: 18_000, transactionCount: 2, isDerived: true },
      { vendor: "AMAZON", totalCents: 9_500, transactionCount: 1, isDerived: true },
    ]);
  });

  it("merges a tidied vendor with matching raw rows and prefers its spelling", () => {
    const totals = vendorTotals([
      transaction({ id: 1, transactionDescription: "COSTCO GAS #1017", amountCents: 6_000 }),
      transaction({ id: 2, vendor: "Costco", transactionDescription: "COSTCO WHSE #1017", amountCents: 4_000 }),
    ]);

    expect(totals).toEqual([
      { vendor: "Costco", totalCents: 10_000, transactionCount: 2, isDerived: false },
    ]);
  });

  it("nets refunds off the vendor's total", () => {
    const totals = vendorTotals([
      transaction({ id: 1, vendor: "Costco", amountCents: 10_000 }),
      transaction({ id: 2, vendor: "Costco", amountCents: -2_500 }),
    ]);

    expect(totals).toEqual([
      { vendor: "Costco", totalCents: 7_500, transactionCount: 2, isDerived: false },
    ]);
  });

  it("groups rows with neither a vendor nor a usable description under an empty name", () => {
    const totals = vendorTotals([
      transaction({ id: 1, transactionDescription: "#4451 0099", amountCents: 500 }),
      transaction({ id: 2, transactionDescription: "", amountCents: 300 }),
    ]);

    expect(totals).toEqual([{ vendor: "", totalCents: 800, transactionCount: 2, isDerived: true }]);
  });

  it("returns nothing for no transactions", () => {
    expect(vendorTotals([])).toEqual([]);
  });
});

describe("totalsByVendor", () => {
  it("rolls up what the repository returns", () => {
    const repo = fakeRepo([
      transaction({ id: 1, vendor: "Costco", amountCents: 5_000 }),
      transaction({ id: 2, transactionDescription: "AMAZON.COM*ABC", amountCents: 7_000 }),
    ]);

    expect(totalsByVendor(repo)).toEqual([
      { vendor: "AMAZON", totalCents: 7_000, transactionCount: 1, isDerived: true },
      { vendor: "Costco", totalCents: 5_000, transactionCount: 1, isDerived: false },
    ]);
  });

  it("forwards the filter, so an out-of-range row is left out", () => {
    const repo = fakeRepo([
      transaction({ id: 1, vendor: "Costco", transactionDate: "2026-07-01", amountCents: 5_000 }),
      transaction({ id: 2, vendor: "Costco", transactionDate: "2026-08-01", amountCents: 1_000 }),
    ]);

    expect(totalsByVendor(repo, { fromDate: "2026-08-01" })).toEqual([
      { vendor: "Costco", totalCents: 1_000, transactionCount: 1, isDerived: false },
    ]);
  });
});
