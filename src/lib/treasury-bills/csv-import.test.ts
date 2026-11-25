import { describe, expect, it } from "vitest";
import {
  autoMapTbillHeaders,
  defaultTbillFieldOptions,
  importTbillCsv,
  planTbillImport,
  testTbillImport,
} from "./csv-import";
import type { TBillRepository } from "./ports";
import type { CreateTBillPurchaseInput, UpdateTBillPurchaseInput } from "./schema";
import type { TBillPurchase } from "./types";

function fakeRepo(seed: TBillPurchase[] = []): TBillRepository & { rows: TBillPurchase[] } {
  let nextId = seed.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  const rows = [...seed];

  return {
    rows,
    listPurchases: () => [...rows],
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
      rows[index] = { ...rows[index], ...input };
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

function storedPurchase(overrides: Partial<TBillPurchase> = {}): TBillPurchase {
  return {
    id: 1,
    symbol: "912797LS4",
    description: "",
    datePurchased: "2026-01-05",
    datePayout: "2026-04-05",
    sharesPurchased: 100,
    purchasePrice: 98.75,
    amountSpentCents: 987_500,
    payoutAmountCents: 1_000_000,
    createdAt: "2026-01-01 00:00:00",
    updatedAt: "2026-01-01 00:00:00",
    ...overrides,
  };
}

const HEADERS = [
  "Symbol",
  "Description",
  "Date Purchased",
  "Share Purchased",
  "Purchase Price",
  "Amount Spent",
  "Date Payout",
  "Payout Amount",
];

/** The mapping those headers auto-map to — column index -> field. */
const MAPPING = autoMapTbillHeaders(HEADERS).columnMapping;

function csv(...dataRows: string[]): string {
  return [HEADERS.join(","), ...dataRows].join("\n");
}

const ONE_ROW = "912797LS4,Treasury Bill,2026-01-05,100,98.75,9875.00,2026-04-05,10000.00";

describe("autoMapTbillHeaders", () => {
  it("maps the headers from the requested table", () => {
    const { columnMapping } = autoMapTbillHeaders(HEADERS);
    expect(columnMapping).toEqual({
      "0": "symbol",
      "1": "description",
      "2": "datePurchased",
      "3": "sharesPurchased",
      "4": "purchasePrice",
      "5": "amountSpent",
      "6": "datePayout",
      "7": "payoutAmount",
    });
  });

  it("recognises common broker spellings, ignoring case and padding", () => {
    const { columnMapping } = autoMapTbillHeaders([" CUSIP ", "Maturity Date", "QTY"]);
    expect(columnMapping).toEqual({ "0": "symbol", "1": "datePayout", "2": "sharesPurchased" });
  });

  it("leaves an unknown header unmapped rather than guessing", () => {
    const { columnMapping } = autoMapTbillHeaders(["Symbol", "Account Nickname", "Broker Notes"]);
    expect(columnMapping).toEqual({ "0": "symbol" });
  });

  it("writes the date fields' default options, not merely implying them", () => {
    // A default that lives only in a <select> fires no change event and so is
    // invisible to the import. It has to be written into the options map.
    const { fieldOptions } = autoMapTbillHeaders(HEADERS);
    expect(fieldOptions["2"]).toEqual({ dateFormat: "YYYY-MM-DD" });
    expect(fieldOptions["6"]).toEqual({ dateFormat: "YYYY-MM-DD" });
    expect(fieldOptions["0"]).toBeUndefined();
  });

  it("offers date options for date fields only", () => {
    expect(defaultTbillFieldOptions("datePurchased")).toEqual({ dateFormat: "YYYY-MM-DD" });
    expect(defaultTbillFieldOptions("symbol")).toBeUndefined();
  });
});

describe("importTbillCsv", () => {
  it("imports a well-formed file", () => {
    const repo = fakeRepo();
    const summary = importTbillCsv(repo, csv(ONE_ROW), MAPPING);

    expect(summary.importedCount).toBe(1);
    expect(repo.rows[0]).toMatchObject({
      symbol: "912797LS4",
      datePurchased: "2026-01-05",
      datePayout: "2026-04-05",
      sharesPurchased: 100,
      purchasePrice: 98.75,
      amountSpentCents: 987_500,
      payoutAmountCents: 1_000_000,
    });
  });

  it("strips currency formatting from the money columns", () => {
    const repo = fakeRepo();
    importTbillCsv(
      repo,
      csv('912797LS4,Treasury Bill,2026-01-05,100,98.75,"$9,875.00",2026-04-05,"$10,000.00"'),
      MAPPING,
    );
    expect(repo.rows[0].amountSpentCents).toBe(987_500);
    expect(repo.rows[0].payoutAmountCents).toBe(1_000_000);
  });

  it("is a no-op when the same file is imported twice", () => {
    const repo = fakeRepo();
    importTbillCsv(repo, csv(ONE_ROW), MAPPING);
    const second = importTbillCsv(repo, csv(ONE_ROW), MAPPING);

    expect(second.importedCount).toBe(0);
    expect(second.skippedCount).toBe(1);
    expect(repo.rows).toHaveLength(1);
  });

  it("keeps a genuine second purchase of the same bill on the same day", () => {
    // The baseline is read ONCE before the run, so the row this run inserts does
    // not make the file's second identical row look like a duplicate of it.
    const repo = fakeRepo();
    const summary = importTbillCsv(repo, csv(ONE_ROW, ONE_ROW), MAPPING);

    expect(summary.importedCount).toBe(2);
    expect(repo.rows).toHaveLength(2);
  });

  it("matches the stored key case-insensitively", () => {
    const repo = fakeRepo([storedPurchase({ symbol: "912797ls4" })]);
    const summary = importTbillCsv(repo, csv(ONE_ROW), MAPPING);

    expect(summary.importedCount).toBe(0);
    expect(summary.skippedCount).toBe(1);
  });

  it("imports a duplicate anyway when skipDuplicates is off", () => {
    const repo = fakeRepo([storedPurchase()]);
    const summary = importTbillCsv(repo, csv(ONE_ROW), MAPPING, { skipDuplicates: false });

    expect(summary.importedCount).toBe(1);
    expect(repo.rows).toHaveLength(2);
  });

  it("skips a bad row, reports it, and still imports the good ones", () => {
    const repo = fakeRepo();
    const summary = importTbillCsv(
      repo,
      csv(
        ONE_ROW,
        // No symbol.
        ",Treasury Bill,2026-02-05,100,98.75,9875.00,2026-05-05,10000.00",
        // Payout before purchase.
        "912797ZZ9,Treasury Bill,2026-06-05,100,98.75,9875.00,2026-03-05,10000.00",
        // Price above par.
        "912797YY8,Treasury Bill,2026-02-05,100,101.25,10125.00,2026-05-05,10000.00",
      ),
      MAPPING,
    );

    expect(summary.importedCount).toBe(1);
    expect(summary.skippedCount).toBe(3);
    expect(repo.rows).toHaveLength(1);
    // Every bad row lands in the summary with its own row number — never fatal,
    // never silent.
    expect(summary.results.filter((result) => result.status === "skipped")).toHaveLength(3);
    for (const result of summary.results.filter((row) => row.status === "skipped")) {
      expect(result.reason).toBeTruthy();
      expect(result.rowNumber).toBeGreaterThan(0);
    }
  });

  it("refuses a row whose date cannot be read instead of defaulting it to today", () => {
    // The shared parseDateToIso falls back to today. That would store a bill with a
    // silently wrong term, and the term divides into the yield.
    const repo = fakeRepo();
    const summary = importTbillCsv(
      repo,
      csv("912797LS4,Treasury Bill,not a date,100,98.75,9875.00,2026-04-05,10000.00"),
      MAPPING,
    );

    expect(summary.importedCount).toBe(0);
    expect(repo.rows).toHaveLength(0);
    expect(summary.results[0].reason).toMatch(/date purchased/i);
  });

  it("refuses a row with no date at all", () => {
    const repo = fakeRepo();
    const summary = importTbillCsv(
      repo,
      csv("912797LS4,Treasury Bill,,100,98.75,9875.00,2026-04-05,10000.00"),
      MAPPING,
    );

    expect(summary.importedCount).toBe(0);
    expect(summary.results[0].reason).toMatch(/Missing date purchased/i);
  });

  it("reads a non-ISO date through the mapped format", () => {
    const repo = fakeRepo();
    const headers = ["Symbol", "Trade Date", "Price", "Amount", "Maturity Date", "Proceeds"];
    const mapping = autoMapTbillHeaders(headers).columnMapping;
    const summary = importTbillCsv(
      repo,
      [headers.join(","), "912797LS4,01/05/2026,98.75,9875.00,04/05/2026,10000.00"].join("\n"),
      mapping,
      { fieldOptions: { "1": { dateFormat: "MM/DD/YYYY" }, "4": { dateFormat: "MM/DD/YYYY" } } },
    );

    expect(summary.importedCount).toBe(1);
    expect(repo.rows[0].datePurchased).toBe("2026-01-05");
    expect(repo.rows[0].datePayout).toBe("2026-04-05");
  });

  it("drops an unticked row entirely rather than reporting it as a skip", () => {
    // A skip is something that surprised the importer. A row the reader unticked
    // is not, so it must not appear in the summary at all.
    const repo = fakeRepo();
    const summary = importTbillCsv(
      repo,
      csv(ONE_ROW, "912797MM1,Treasury Bill,2026-02-05,100,99,9900.00,2026-05-05,10000.00"),
      MAPPING,
      { excludedRowIndexes: [0] },
    );

    expect(summary.importedCount).toBe(1);
    expect(summary.skippedCount).toBe(0);
    expect(repo.rows[0].symbol).toBe("912797MM1");
  });

  it("applies a fixed value over the mapped cells", () => {
    const repo = fakeRepo();
    importTbillCsv(repo, csv(ONE_ROW), MAPPING, {
      fieldOptions: { "1": { constantValue: "Fixed description" } },
    });
    expect(repo.rows[0].description).toBe("Fixed description");
  });
});

describe("planTbillImport", () => {
  it("says what the import would do without doing it", () => {
    const repo = fakeRepo([storedPurchase()]);
    const plan = planTbillImport(
      repo,
      csv(ONE_ROW, "912797MM1,Treasury Bill,2026-02-05,100,99,9900.00,2026-05-05,10000.00"),
      MAPPING,
    );

    expect(plan.createCount).toBe(1);
    expect(plan.skipCount).toBe(1);
    expect(plan.rows[0]).toMatchObject({ action: "skip", symbol: "912797LS4" });
    expect(plan.rows[1]).toMatchObject({ action: "create", symbol: "912797MM1" });
    // Nothing was written.
    expect(repo.rows).toHaveLength(1);
  });

  it("agrees with what the import then does", () => {
    // The plan and the run share one walk, so this can only fail if that changes.
    const file = csv(
      ONE_ROW,
      ",Treasury Bill,2026-02-05,100,98.75,9875.00,2026-05-05,10000.00",
      "912797MM1,Treasury Bill,2026-02-05,100,99,9900.00,2026-05-05,10000.00",
    );
    const plan = planTbillImport(fakeRepo(), file, MAPPING);
    const summary = importTbillCsv(fakeRepo(), file, MAPPING);

    expect(plan.createCount).toBe(summary.importedCount);
    expect(plan.skipCount).toBe(summary.skippedCount);
  });
});

describe("testTbillImport", () => {
  it("reports what would be stored, and writes nothing", () => {
    const rows = testTbillImport(csv(ONE_ROW), MAPPING);

    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(true);
    expect(rows[0].values).toMatchObject({
      Symbol: "912797LS4",
      "Date purchased": "2026-01-05",
      "Date payout": "2026-04-05",
      "Amount spent": "9875.00",
    });
  });

  it("reports a bad row's reason rather than throwing", () => {
    const rows = testTbillImport(
      csv("912797ZZ9,Treasury Bill,2026-06-05,100,98.75,9875.00,2026-03-05,10000.00"),
      MAPPING,
    );

    expect(rows[0].ok).toBe(false);
    expect(rows[0].reason).toMatch(/cannot be before the purchase date/);
  });
});
