import { describe, expect, it } from "vitest";
import {
  TRANSACTION_GROUP_BYS,
  UNCATEGORISED_GROUP_LABEL,
  UNDATED_GROUP_LABEL,
  UNKNOWN_VENDOR_GROUP_LABEL,
  accountGroupKey,
  categoryGroupKey,
  cycleDateFor,
  groupTransactions,
  isTransactionGroupBy,
  vendorGroupKeyForName,
} from "./grouping";
import type { CreditCardAccount, ExpenseTransaction } from "./types";

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

function account(overrides: Partial<CreditCardAccount> = {}): CreditCardAccount {
  return {
    id: 1,
    name: "Visa Gold",
    description: "",
    creditLineCents: 0,
    statementCloseDay: 28,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("groupTransactions — all", () => {
  it("returns one group holding every row", () => {
    const rows = [transaction({ id: 1, amountCents: 500 }), transaction({ id: 2, amountCents: 250 })];
    const groups = groupTransactions(rows, "all", [account()]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "all", transactionCount: 2, totalCents: 750 });
    expect(groups[0].rows).toEqual(rows);
  });

  it("returns one empty group when there are no transactions", () => {
    const groups = groupTransactions([], "all", []);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ transactionCount: 0, totalCents: 0 });
  });
});

describe("groupTransactions — account", () => {
  const accounts = [
    account({ id: 1, name: "Visa Gold", description: "everyday" }),
    account({ id: 2, name: "Amex Blue" }),
  ];

  it("groups by card, in the account list's order", () => {
    const rows = [
      transaction({ id: 1, transactionAccountId: 2, amountCents: 100 }),
      transaction({ id: 2, transactionAccountId: 1, amountCents: 300 }),
      transaction({ id: 3, transactionAccountId: 1, amountCents: 200 }),
    ];
    const groups = groupTransactions(rows, "account", accounts);

    expect(groups.map((group) => group.label)).toEqual(["Visa Gold", "Amex Blue"]);
    expect(groups[0]).toMatchObject({
      sublabel: "everyday",
      transactionCount: 2,
      totalCents: 500,
      accountId: 1,
    });
    expect(groups[1]).toMatchObject({ transactionCount: 1, totalCents: 100, accountId: 2 });
  });

  it("keeps a card with no transactions as an empty group", () => {
    const groups = groupTransactions([transaction({ transactionAccountId: 1 })], "account", accounts);
    expect(groups[1]).toMatchObject({ label: "Amex Blue", transactionCount: 0, totalCents: 0 });
  });

  it("nets a refund against the charges on the same card", () => {
    const rows = [
      transaction({ id: 1, amountCents: 5000 }),
      transaction({ id: 2, amountCents: -2000 }),
    ];
    expect(groupTransactions(rows, "account", accounts)[0].totalCents).toBe(3000);
  });

  it("surfaces rows pointing at a card that no longer exists", () => {
    const rows = [transaction({ id: 1, transactionAccountId: 99, amountCents: 400 })];
    const groups = groupTransactions(rows, "account", accounts);

    const orphan = groups.find((group) => group.label === "Unknown card #99");
    expect(orphan).toMatchObject({ transactionCount: 1, totalCents: 400 });
  });
});

describe("groupTransactions — cycle", () => {
  it("splits one card's rows into statement periods, newest first", () => {
    const rows = [
      // Closes 28 Aug.
      transaction({ id: 1, transactionDate: "2026-08-10", amountCents: 100 }),
      // Closes 28 Jul.
      transaction({ id: 2, transactionDate: "2026-07-10", amountCents: 200 }),
      // Day after the July close, so it opens the August cycle.
      transaction({ id: 3, transactionDate: "2026-07-29", amountCents: 300 }),
    ];
    const groups = groupTransactions(rows, "cycle", [account({ statementCloseDay: 28 })]);

    expect(groups.map((group) => group.label)).toEqual([
      "29 Jul – 28 Aug 2026",
      "29 Jun – 28 Jul 2026",
    ]);
    expect(groups[0]).toMatchObject({ transactionCount: 2, totalCents: 400 });
    expect(groups[1]).toMatchObject({ transactionCount: 1, totalCents: 200 });
  });

  it("names the card as the sublabel, since a cycle belongs to one card", () => {
    const groups = groupTransactions(
      [transaction({ transactionDate: "2026-08-10" })],
      "cycle",
      [account({ name: "Amex Blue" })],
    );
    expect(groups[0].sublabel).toBe("Amex Blue");
  });

  it("keeps two cards' periods apart even when they overlap in the calendar", () => {
    // Same purchase date, different close days, so different statements.
    const rows = [
      transaction({ id: 1, transactionAccountId: 1, transactionDate: "2026-08-10" }),
      transaction({ id: 2, transactionAccountId: 2, transactionDate: "2026-08-10" }),
    ];
    const groups = groupTransactions(rows, "cycle", [
      account({ id: 1, name: "Visa Gold", statementCloseDay: 28 }),
      account({ id: 2, name: "Amex Blue", statementCloseDay: 5 }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ label: "29 Jul – 28 Aug 2026", sublabel: "Visa Gold" });
    expect(groups[1]).toMatchObject({ label: "6 Aug – 5 Sep 2026", sublabel: "Amex Blue" });
  });

  it("measures by the posting date when the statement supplied one", () => {
    // Bought before the close, posted after it — the statement counts the latter.
    const rows = [
      transaction({ id: 1, transactionDate: "2026-08-27", postingDate: "2026-08-30" }),
    ];
    const groups = groupTransactions(rows, "cycle", [account({ statementCloseDay: 28 })]);
    expect(groups[0].label).toBe("29 Aug – 28 Sep 2026");
  });

  it("collects rows with no usable date under their card rather than dropping them", () => {
    const rows = [
      transaction({ id: 1, transactionDate: "2026-08-10", amountCents: 100 }),
      transaction({ id: 2, transactionDate: "", amountCents: 700 }),
    ];
    const groups = groupTransactions(rows, "cycle", [account()]);

    expect(groups).toHaveLength(2);
    // Undated goes last, so a real statement is never pushed down the screen.
    expect(groups[1]).toMatchObject({
      label: UNDATED_GROUP_LABEL,
      transactionCount: 1,
      totalCents: 700,
    });
  });

  it("falls back to the default close day for a card that predates the column", () => {
    // statementCloseDay 0 is what migration 0070 leaves on an untouched row.
    const rows = [transaction({ transactionDate: "2026-08-10" })];
    const groups = groupTransactions(rows, "cycle", [account({ statementCloseDay: 0 })]);
    expect(groups[0].label).toBe("29 Jul – 28 Aug 2026");
  });

  it("produces no groups for a card with no transactions", () => {
    expect(groupTransactions([], "cycle", [account()])).toEqual([]);
  });
});

describe("groupTransactions — vendor", () => {
  it("groups on the shared vendor key and orders by net spend", () => {
    const rows = [
      transaction({ id: 1, vendor: "Costco", amountCents: 1000 }),
      transaction({ id: 2, vendor: "COSTCO", amountCents: 500 }),
      transaction({ id: 3, vendor: "TGI Friday", amountCents: 4000 }),
    ];
    const groups = groupTransactions(rows, "vendor", [account()]);

    expect(groups.map((group) => group.label)).toEqual(["TGI Friday", "Costco"]);
    expect(groups[1]).toMatchObject({ transactionCount: 2, totalCents: 1500 });
  });

  it("falls back to the description's brand key when no row was tidied", () => {
    const rows = [
      transaction({ id: 1, transactionDescription: "COSTCO WHSE #1017 SEATTLE WA", amountCents: 100 }),
      transaction({ id: 2, transactionDescription: "COSTCO GAS #1017", amountCents: 200 }),
    ];
    const groups = groupTransactions(rows, "vendor", [account()]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ label: "COSTCO", transactionCount: 2, totalCents: 300 });
  });

  it("prefers a tidied name over the derived key inside one group", () => {
    const rows = [
      transaction({ id: 1, transactionDescription: "COSTCO GAS #1017" }),
      transaction({ id: 2, transactionDescription: "COSTCO WHSE", vendor: "Costco" }),
    ];
    // Both rows key on COSTCO — the tidied spelling is what the group shows.
    const groups = groupTransactions(rows, "vendor", [account()]);
    expect(groups[0].label).toBe("Costco");
  });

  it("labels rows with no usable vendor name", () => {
    const groups = groupTransactions([transaction({ transactionDescription: "12345" })], "vendor", []);
    expect(groups[0].label).toBe(UNKNOWN_VENDOR_GROUP_LABEL);
  });
});

describe("groupTransactions — category", () => {
  it("groups by category, biggest net spend first", () => {
    const rows = [
      transaction({ id: 1, categoryName: "Groceries", amountCents: 500 }),
      transaction({ id: 2, categoryName: "Restaurant", amountCents: 4000 }),
      transaction({ id: 3, categoryName: "Groceries", amountCents: 1000 }),
    ];
    const groups = groupTransactions(rows, "category", [account()]);

    expect(groups.map((group) => group.label)).toEqual(["Restaurant", "Groceries"]);
    expect(groups[1]).toMatchObject({ transactionCount: 2, totalCents: 1500 });
  });

  it("gives the uncategorised rows their own named group", () => {
    const rows = [
      transaction({ id: 1, categoryName: "", amountCents: 900 }),
      transaction({ id: 2, categoryName: "Groceries", amountCents: 100 }),
    ];
    const groups = groupTransactions(rows, "category", [account()]);

    expect(groups[0]).toMatchObject({
      label: UNCATEGORISED_GROUP_LABEL,
      transactionCount: 1,
      totalCents: 900,
    });
  });
});

describe("cycleDateFor", () => {
  it("prefers the posting date", () => {
    expect(cycleDateFor(transaction({ transactionDate: "2026-08-01", postingDate: "2026-08-03" }))).toBe(
      "2026-08-03",
    );
  });

  it("falls back to the transaction date when posting is blank or whitespace", () => {
    expect(cycleDateFor(transaction({ transactionDate: "2026-08-01", postingDate: "" }))).toBe(
      "2026-08-01",
    );
    expect(cycleDateFor(transaction({ transactionDate: "2026-08-01", postingDate: "   " }))).toBe(
      "2026-08-01",
    );
  });
});

// These assert against real groupTransactions output rather than a hardcoded
// string, because the point of the helpers is that the two agree. Comparing a
// key to a literal would still pass if the grouping changed its format and
// every Meta Data link broke.
describe("group key helpers", () => {
  it("names the account group groupTransactions builds", () => {
    const groups = groupTransactions([transaction({ transactionAccountId: 7 })], "account", [
      account({ id: 7 }),
    ]);

    expect(groups[0].key).toBe(accountGroupKey(7));
  });

  it("names the category group groupTransactions builds", () => {
    const groups = groupTransactions([transaction({ categoryName: "Gas" })], "category", []);

    expect(groups[0].key).toBe(categoryGroupKey("Gas"));
  });

  it("keeps categories differing only in case apart", () => {
    expect(categoryGroupKey("Gas")).not.toBe(categoryGroupKey("gas"));
  });

  it("names the vendor group groupTransactions builds", () => {
    const groups = groupTransactions([transaction({ vendor: "COSTCO" })], "vendor", []);

    expect(groups[0].key).toBe(vendorGroupKeyForName("COSTCO"));
  });

  it("matches a vendor saved in mixed case, which groups upper-cased", () => {
    const groups = groupTransactions([transaction({ vendor: "Costco" })], "vendor", []);

    expect(groups[0].key).toBe(vendorGroupKeyForName("Costco"));
    expect(vendorGroupKeyForName("Costco")).toBe(vendorGroupKeyForName("COSTCO"));
  });

  it("ignores surrounding whitespace on a vendor name", () => {
    expect(vendorGroupKeyForName("  Costco  ")).toBe(vendorGroupKeyForName("Costco"));
  });
});

describe("isTransactionGroupBy", () => {
  it("accepts every grouping the switcher offers", () => {
    for (const groupBy of TRANSACTION_GROUP_BYS) {
      expect(isTransactionGroupBy(groupBy)).toBe(true);
    }
  });

  it("rejects an unknown or missing value from the URL", () => {
    expect(isTransactionGroupBy("merchant")).toBe(false);
    expect(isTransactionGroupBy("")).toBe(false);
    expect(isTransactionGroupBy(undefined)).toBe(false);
  });
});
