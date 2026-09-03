import { describe, expect, it } from "vitest";
import type { ExpenseRepository, TransactionFilter } from "./ports";
import type { ExpenseTransaction, ExpenseVendor } from "./types";
import {
  mergeVendorsWithTotals,
  totalsByVendor,
  vendorGroupKey,
  vendorKeyFromDescription,
  vendorSpendTotals,
  vendorTotals,
} from "./vendors";

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
    // Ticketmaster prints "TM *"; without the prefix the key would be "TM".
    expect(vendorKeyFromDescription("TM  *TICKETMASTER 8004531463")).toBe("TICKETMASTER");
  });

  it("only strips a prefix when the marker `*` follows it", () => {
    // The guard that stops "TM" eating a merchant that merely starts with it.
    expect(vendorKeyFromDescription("TM LANDSCAPING LLC")).toBe("TM");
    expect(vendorKeyFromDescription("SQUARE ONE BAKERY")).toBe("SQUARE");
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

describe("vendorSpendTotals", () => {
  it("drops the fictional vendors a payment or redemption line derives", () => {
    // The bug this exists for: no vendor field, so the key comes from statement
    // prose and "ONLINE"/"REDEEM" ranked against real shops on the dashboard.
    const totals = vendorSpendTotals([
      transaction({ id: 1, transactionDescription: "COSTCO WHSE #1017", amountCents: 12_000 }),
      transaction({ id: 2, transactionDescription: "ONLINE PAYMENT THANK YOU", amountCents: -50_000 }),
      transaction({ id: 3, transactionDescription: "REDEEM CASH BACK", amountCents: -2_500 }),
    ]);

    expect(totals).toEqual([
      { vendor: "COSTCO", totalCents: 12_000, transactionCount: 1, isDerived: true },
    ]);
  });

  it("keeps a vendor whose refunds do not outweigh its charges", () => {
    const totals = vendorSpendTotals([
      transaction({ id: 1, vendor: "Costco", amountCents: 10_000 }),
      transaction({ id: 2, vendor: "Costco", amountCents: -2_500 }),
    ]);

    expect(totals).toEqual([
      { vendor: "Costco", totalCents: 7_500, transactionCount: 2, isDerived: false },
    ]);
  });

  it("drops a vendor that nets to zero or below", () => {
    // Fully refunded, and a net credit. Neither is a "biggest spender".
    expect(
      vendorSpendTotals([
        transaction({ id: 1, vendor: "Costco", amountCents: 5_000 }),
        transaction({ id: 2, vendor: "Costco", amountCents: -5_000 }),
      ]),
    ).toEqual([]);

    expect(
      vendorSpendTotals([transaction({ id: 3, vendor: "Refunder", amountCents: -900 })]),
    ).toEqual([]);
  });

  it("returns nothing for no transactions", () => {
    expect(vendorSpendTotals([])).toEqual([]);
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

function savedVendor(overrides: Partial<ExpenseVendor> = {}): ExpenseVendor {
  return {
    name: "COSTCO",
    description: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("mergeVendorsWithTotals", () => {
  it("lists a vendor that only exists in the transactions, marked unsaved", () => {
    const totals = vendorTotals([transaction({ vendor: "Costco", amountCents: 4500 })]);

    const merged = mergeVendorsWithTotals([], totals);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      name: "Costco",
      isSaved: false,
      isInUse: true,
      totalCents: 4500,
      transactionCount: 1,
    });
  });

  it("lists a saved vendor with no transactions, so it can still be deleted", () => {
    const merged = mergeVendorsWithTotals([savedVendor({ name: "Old Shop" })], []);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ name: "Old Shop", isSaved: true, isInUse: false });
    expect(merged[0].totalCents).toBe(0);
  });

  it("merges the two sides into one entry, keeping the spend and the icon", () => {
    const totals = vendorTotals([transaction({ vendor: "Costco", amountCents: 4500 })]);
    const saved = [savedVendor({ name: "Costco", description: "warehouse", iconMimeType: "image/png" })];

    const merged = mergeVendorsWithTotals(saved, totals);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      name: "Costco",
      description: "warehouse",
      iconMimeType: "image/png",
      isSaved: true,
      isInUse: true,
      totalCents: 4500,
    });
  });

  it("matches the two sides regardless of case, preferring the saved spelling", () => {
    const totals = vendorTotals([transaction({ vendor: "Costco", amountCents: 4500 })]);

    // The row is stored upper-case but the transaction says "Costco". One entry,
    // named the way it was saved — this is the case the NOCASE index exists for.
    const merged = mergeVendorsWithTotals([savedVendor({ name: "COSTCO" })], totals);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ name: "COSTCO", isSaved: true, isInUse: true, totalCents: 4500 });
  });

  it("skips a rollup group with no usable name", () => {
    // A description with no brand in it yields an empty group name, which isn't
    // a vendor anyone can save or give an icon to.
    const totals = vendorTotals([transaction({ transactionDescription: "12345", amountCents: 100 })]);

    expect(mergeVendorsWithTotals([], totals)).toHaveLength(0);
  });

  it("orders by spend, then by name, within the unsaved group", () => {
    const totals = vendorTotals([
      transaction({ id: 1, vendor: "Small", amountCents: 100 }),
      transaction({ id: 2, vendor: "Big", amountCents: 9000 }),
      transaction({ id: 3, vendor: "Middle", amountCents: 500 }),
    ]);

    const merged = mergeVendorsWithTotals([], totals);

    expect(merged.map((entry) => entry.name)).toEqual(["Big", "Middle", "Small"]);
  });

  it("puts saved vendors above unsaved ones, whatever they spent", () => {
    const totals = vendorTotals([
      // The unsaved vendor outspends both saved ones by an order of magnitude,
      // so this fails if spend is still the primary sort key.
      transaction({ id: 1, vendor: "Derived", amountCents: 90000 }),
      transaction({ id: 2, vendor: "Costco", amountCents: 4500 }),
    ]);

    const merged = mergeVendorsWithTotals(
      [savedVendor({ name: "Costco" }), savedVendor({ name: "Unused" })],
      totals,
    );

    // Saved first (Costco has spend, Unused has none), then the derived tail.
    expect(merged.map((entry) => entry.name)).toEqual(["Costco", "Unused", "Derived"]);
    expect(merged.map((entry) => entry.isSaved)).toEqual([true, true, false]);
  });
});
