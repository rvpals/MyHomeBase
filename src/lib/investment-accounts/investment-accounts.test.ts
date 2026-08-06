import { describe, expect, it } from "vitest";
import {
  addPerformanceRecord,
  buildAccountPerformanceHistory,
  clearAccountIcon,
  createAccount,
  deleteAccount,
  deletePerformanceRecord,
  extractCsvAccountNames,
  getAccountById,
  getAccountIcon,
  importPerformanceFromCsv,
  listAccounts,
  listPerformanceRecords,
  setAccountIcon,
  updateAccount,
  updatePerformanceRecord,
} from "./investment-accounts";
import type { InvestmentAccountRepository } from "./ports";
import type {
  CreateInvestmentAccountInput,
  CreatePerformanceRecordInput,
  UpdateInvestmentAccountInput,
} from "./schema";
import type { AccountIcon, InvestmentAccount, PerformanceRecord } from "./types";

// Hand-written fake — no mocking framework, reusable across tests. Mirrors the
// real repository's "sync last value on every performance-record mutation" behavior.
function fakeRepo(
  seedAccounts: InvestmentAccount[],
  seedRecords: PerformanceRecord[] = [],
): InvestmentAccountRepository {
  let accounts = [...seedAccounts];
  let records = [...seedRecords];
  let nextAccountId = accounts.reduce((max, account) => Math.max(max, account.id), 0) + 1;
  let nextRecordId = records.reduce((max, record) => Math.max(max, record.id), 0) + 1;
  // Icon bytes live outside the account rows, matching the real repository, where
  // they're a column no normal read selects.
  const icons = new Map<number, AccountIcon>();

  function syncLastValue(accountId: number): void {
    const latest = records
      .filter((record) => record.accountId === accountId)
      .sort((a, b) => b.recordDate.localeCompare(a.recordDate))[0];
    accounts = accounts.map((account) =>
      account.id === accountId
        ? {
            ...account,
            lastValueCents: latest?.totalValueCents,
            lastUpdatedAt: latest?.recordDate,
          }
        : account,
    );
  }

  return {
    listAccounts() {
      return [...accounts];
    },
    getAccountById(id) {
      return accounts.find((account) => account.id === id);
    },
    getAccountIcon(id) {
      return icons.get(id);
    },
    setAccountIcon(id, icon) {
      if (icon) {
        icons.set(id, icon);
        accounts = accounts.map((account) =>
          account.id === id ? { ...account, iconMimeType: icon.mimeType } : account,
        );
      } else {
        icons.delete(id);
        accounts = accounts.map((account) =>
          account.id === id ? { ...account, iconMimeType: undefined } : account,
        );
      }
    },
    createAccount(input) {
      const created: InvestmentAccount = {
        id: nextAccountId++,
        ...input,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      accounts.push(created);
      return created;
    },
    updateAccount(id, input) {
      accounts = accounts.map((account) =>
        account.id === id ? { ...account, ...input, updatedAt: "2026-01-02T00:00:00.000Z" } : account,
      );
      const updated = accounts.find((account) => account.id === id);
      if (!updated) throw new Error(`Account ${id} not found.`);
      return updated;
    },
    deleteAccount(id) {
      accounts = accounts.filter((account) => account.id !== id);
      records = records.filter((record) => record.accountId !== id);
    },
    listPerformanceRecords(accountId) {
      return accountId === undefined
        ? [...records]
        : records.filter((record) => record.accountId === accountId);
    },
    getPerformanceRecordById(id) {
      return records.find((record) => record.id === id);
    },
    addPerformanceRecord(input) {
      const existing = records.find(
        (record) => record.accountId === input.accountId && record.recordDate === input.recordDate,
      );
      let saved: PerformanceRecord;
      if (existing) {
        saved = { ...existing, ...input, updatedAt: "2026-01-02T00:00:00.000Z" };
        records = records.map((record) => (record.id === existing.id ? saved : record));
      } else {
        saved = {
          id: nextRecordId++,
          ...input,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        };
        records.push(saved);
      }
      syncLastValue(input.accountId);
      return saved;
    },
    updatePerformanceRecord(id, input) {
      const existing = records.find((record) => record.id === id);
      if (!existing) throw new Error(`Performance record ${id} not found.`);
      records = records.map((record) =>
        record.id === id ? { ...record, ...input, updatedAt: "2026-01-02T00:00:00.000Z" } : record,
      );
      syncLastValue(existing.accountId);
      const updated = records.find((record) => record.id === id);
      if (!updated) throw new Error(`Performance record ${id} not found.`);
      return updated;
    },
    deletePerformanceRecord(id) {
      const existing = records.find((record) => record.id === id);
      if (!existing) return;
      records = records.filter((record) => record.id !== id);
      syncLastValue(existing.accountId);
    },
    addPerformanceRecordIfNotExists(input) {
      const duplicate = records.find(
        (record) => record.accountId === input.accountId && record.recordDate === input.recordDate,
      );
      if (duplicate) return { inserted: false };

      const created: PerformanceRecord = {
        id: nextRecordId++,
        ...input,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      records.push(created);
      syncLastValue(input.accountId);
      return { inserted: true, record: created };
    },
  };
}

const sampleAccounts: InvestmentAccount[] = [
  {
    id: 1,
    name: "Brokerage",
    description: "Main taxable account",
    initialValueCents: 1000000,
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    name: "Roth IRA",
    description: "",
    initialValueCents: 500000,
    createdAt: "2021-01-01T00:00:00.000Z",
    updatedAt: "2021-01-01T00:00:00.000Z",
  },
];

describe("listAccounts", () => {
  it("returns every account", () => {
    expect(listAccounts(fakeRepo(sampleAccounts))).toHaveLength(2);
  });
});

describe("getAccountById", () => {
  it("returns the matching account", () => {
    expect(getAccountById(fakeRepo(sampleAccounts), 2)?.name).toBe("Roth IRA");
  });

  it("returns undefined when no account matches", () => {
    expect(getAccountById(fakeRepo(sampleAccounts), 999)).toBeUndefined();
  });
});

describe("account icons", () => {
  // 1x1 transparent PNG — a real image, small enough that size assertions test the
  // cap rather than the fixture.
  const tinyPng =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

  it("stores an icon and reads it back", () => {
    const repo = fakeRepo(sampleAccounts);
    setAccountIcon(repo, 1, { mimeType: "image/png", base64Data: tinyPng });
    const icon = getAccountIcon(repo, 1);
    expect(icon?.mimeType).toBe("image/png");
    expect(icon?.data.length).toBeGreaterThan(0);
  });

  it("advertises the icon's type on the account, without the bytes", () => {
    const repo = fakeRepo(sampleAccounts);
    setAccountIcon(repo, 1, { mimeType: "image/png", base64Data: tinyPng });
    const account = getAccountById(repo, 1)!;
    expect(account.iconMimeType).toBe("image/png");
    // The list must never carry image bytes — that's the whole point of the route.
    expect(Object.keys(account)).not.toContain("iconImage");
  });

  it("clears an icon without touching the account", () => {
    const repo = fakeRepo(sampleAccounts);
    setAccountIcon(repo, 1, { mimeType: "image/png", base64Data: tinyPng });
    clearAccountIcon(repo, 1);
    expect(getAccountIcon(repo, 1)).toBeUndefined();
    expect(getAccountById(repo, 1)?.name).toBe("Brokerage");
    expect(getAccountById(repo, 1)?.iconMimeType).toBeUndefined();
  });

  it("replaces an existing icon rather than keeping both", () => {
    const repo = fakeRepo(sampleAccounts);
    setAccountIcon(repo, 1, { mimeType: "image/png", base64Data: tinyPng });
    setAccountIcon(repo, 1, { mimeType: "image/gif", base64Data: tinyPng });
    expect(getAccountIcon(repo, 1)?.mimeType).toBe("image/gif");
  });

  it("leaves other accounts' icons alone", () => {
    const repo = fakeRepo(sampleAccounts);
    setAccountIcon(repo, 1, { mimeType: "image/png", base64Data: tinyPng });
    setAccountIcon(repo, 2, { mimeType: "image/gif", base64Data: tinyPng });
    clearAccountIcon(repo, 1);
    expect(getAccountIcon(repo, 2)?.mimeType).toBe("image/gif");
  });

  it("returns undefined for an account that never had one", () => {
    expect(getAccountIcon(fakeRepo(sampleAccounts), 2)).toBeUndefined();
  });

  it("rejects an upload for an account that doesn't exist", () => {
    const repo = fakeRepo(sampleAccounts);
    expect(() => setAccountIcon(repo, 999, { mimeType: "image/png", base64Data: tinyPng })).toThrow(
      /no investment account/i,
    );
    expect(() => clearAccountIcon(repo, 999)).toThrow(/no investment account/i);
  });

  it("rejects an SVG, which could carry script and would be served from our origin", () => {
    const repo = fakeRepo(sampleAccounts);
    expect(() =>
      setAccountIcon(repo, 1, { mimeType: "image/svg+xml" as never, base64Data: tinyPng }),
    ).toThrow();
    expect(getAccountIcon(repo, 1)).toBeUndefined();
  });

  it("rejects an icon over the 128 KB cap", () => {
    const repo = fakeRepo(sampleAccounts);
    const tooBig = Buffer.alloc(200 * 1024, 1).toString("base64");
    expect(() => setAccountIcon(repo, 1, { mimeType: "image/png", base64Data: tooBig })).toThrow(
      /too large/i,
    );
  });
});

describe("createAccount", () => {
  const validInput: CreateInvestmentAccountInput = {
    name: "New Account",
    description: "",
    initialValueCents: 0,
  };

  it("creates an account and returns it with an id", () => {
    const repo = fakeRepo(sampleAccounts);
    const created = createAccount(repo, validInput);
    expect(created.id).toBe(3);
    expect(listAccounts(repo)).toHaveLength(3);
  });

  it("rejects an empty name", () => {
    const repo = fakeRepo(sampleAccounts);
    expect(() => createAccount(repo, { ...validInput, name: "" })).toThrow();
  });

  it("rejects a negative initial value", () => {
    const repo = fakeRepo(sampleAccounts);
    expect(() => createAccount(repo, { ...validInput, initialValueCents: -100 })).toThrow();
  });
});

describe("updateAccount", () => {
  const validInput: UpdateInvestmentAccountInput = {
    name: "Brokerage (Renamed)",
    description: "Main taxable account",
    initialValueCents: 1000000,
  };

  it("updates an existing account", () => {
    const repo = fakeRepo(sampleAccounts);
    const updated = updateAccount(repo, 1, validInput);
    expect(updated.name).toBe("Brokerage (Renamed)");
  });

  it("rejects an invalid update", () => {
    const repo = fakeRepo(sampleAccounts);
    expect(() => updateAccount(repo, 1, { ...validInput, name: "" })).toThrow();
  });
});

describe("deleteAccount", () => {
  it("removes the account", () => {
    const repo = fakeRepo(sampleAccounts);
    deleteAccount(repo, 1);
    expect(listAccounts(repo)).toHaveLength(1);
  });
});

describe("addPerformanceRecord", () => {
  const validInput: CreatePerformanceRecordInput = {
    accountId: 1,
    totalValueCents: 1100000,
    recordDate: "2026-01-15",
    note: "",
  };

  it("adds a record and syncs the account's last value", () => {
    const repo = fakeRepo(sampleAccounts);
    addPerformanceRecord(repo, validInput);
    expect(getAccountById(repo, 1)?.lastValueCents).toBe(1100000);
    expect(getAccountById(repo, 1)?.lastUpdatedAt).toBe("2026-01-15");
  });

  it("syncs to the latest date, not just the most recently added record", () => {
    const repo = fakeRepo(sampleAccounts);
    addPerformanceRecord(repo, { ...validInput, recordDate: "2026-01-15", totalValueCents: 1100000 });
    addPerformanceRecord(repo, { ...validInput, recordDate: "2026-01-05", totalValueCents: 1050000 });
    expect(getAccountById(repo, 1)?.lastValueCents).toBe(1100000);
    expect(getAccountById(repo, 1)?.lastUpdatedAt).toBe("2026-01-15");
  });

  it("rejects a record for a non-existent account", () => {
    const repo = fakeRepo(sampleAccounts);
    expect(() => addPerformanceRecord(repo, { ...validInput, accountId: 999 })).toThrow();
  });

  it("rejects a negative total value", () => {
    const repo = fakeRepo(sampleAccounts);
    expect(() => addPerformanceRecord(repo, { ...validInput, totalValueCents: -1 })).toThrow();
  });
});

describe("listPerformanceRecords", () => {
  it("filters by accountId when given", () => {
    const repo = fakeRepo(sampleAccounts);
    addPerformanceRecord(repo, { accountId: 1, totalValueCents: 100, recordDate: "2026-01-01", note: "" });
    addPerformanceRecord(repo, { accountId: 2, totalValueCents: 200, recordDate: "2026-01-01", note: "" });
    expect(listPerformanceRecords(repo, 1)).toHaveLength(1);
  });

  it("returns all records when accountId is omitted", () => {
    const repo = fakeRepo(sampleAccounts);
    addPerformanceRecord(repo, { accountId: 1, totalValueCents: 100, recordDate: "2026-01-01", note: "" });
    addPerformanceRecord(repo, { accountId: 2, totalValueCents: 200, recordDate: "2026-01-01", note: "" });
    expect(listPerformanceRecords(repo)).toHaveLength(2);
  });
});

describe("deletePerformanceRecord and updatePerformanceRecord re-sync last value", () => {
  it("falls back to the prior latest record after deleting the current latest", () => {
    const repo = fakeRepo(sampleAccounts);
    addPerformanceRecord(repo, { accountId: 1, totalValueCents: 1050000, recordDate: "2026-01-05", note: "" });
    const latest = addPerformanceRecord(repo, {
      accountId: 1,
      totalValueCents: 1100000,
      recordDate: "2026-01-15",
      note: "",
    });
    deletePerformanceRecord(repo, latest.id);
    expect(getAccountById(repo, 1)?.lastValueCents).toBe(1050000);
  });

  it("re-syncs after an update changes the record's date ordering", () => {
    const repo = fakeRepo(sampleAccounts);
    const record = addPerformanceRecord(repo, {
      accountId: 1,
      totalValueCents: 1050000,
      recordDate: "2026-01-05",
      note: "",
    });
    updatePerformanceRecord(repo, record.id, {
      totalValueCents: 1200000,
      recordDate: "2026-02-01",
      note: "revised",
    });
    expect(getAccountById(repo, 1)?.lastValueCents).toBe(1200000);
    expect(getAccountById(repo, 1)?.lastUpdatedAt).toBe("2026-02-01");
  });
});

describe("extractCsvAccountNames", () => {
  it("returns distinct, sorted account names from the mapped column", () => {
    const csv = "Account,Value\nRoth IRA,100\nBrokerage,200\nRoth IRA,150";
    expect(extractCsvAccountNames(csv, { "0": "accountName", "1": "totalValue" })).toEqual([
      "Brokerage",
      "Roth IRA",
    ]);
  });

  it("returns an empty array when no column is mapped to accountName", () => {
    expect(extractCsvAccountNames("Value\n100", { "0": "totalValue" })).toEqual([]);
  });
});

describe("importPerformanceFromCsv", () => {
  const mapping = { "0": "date", "1": "accountName", "2": "totalValue" };

  it("resolves an account by case-insensitive exact name match", () => {
    const repo = fakeRepo(sampleAccounts);
    const summary = importPerformanceFromCsv(
      repo,
      "Date,Account,Value\n2026-01-15,brokerage,11000.00",
      mapping,
      {},
    );
    expect(summary.importedCount).toBe(1);
    expect(listPerformanceRecords(repo, 1)[0].totalValueCents).toBe(1100000);
  });

  it("uses the explicit account-name mapping over a fuzzy match when both are available", () => {
    const repo = fakeRepo(sampleAccounts);
    const summary = importPerformanceFromCsv(
      repo,
      "Date,Account,Value\n2026-01-15,My Old Brokerage,11000.00",
      mapping,
      { "My Old Brokerage": 2 },
    );
    expect(summary.importedCount).toBe(1);
    expect(listPerformanceRecords(repo, 2)).toHaveLength(1);
  });

  it("skips a row whose account name matches nothing", () => {
    const repo = fakeRepo(sampleAccounts);
    const summary = importPerformanceFromCsv(
      repo,
      "Date,Account,Value\n2026-01-15,Nonexistent Account,11000.00",
      mapping,
      {},
    );
    expect(summary.skippedCount).toBe(1);
    expect(summary.results[0].reason).toMatch(/No matching account/);
  });

  it("skips a duplicate of an existing performance record instead of overwriting it", () => {
    const repo = fakeRepo(sampleAccounts);
    addPerformanceRecord(repo, { accountId: 1, totalValueCents: 999900, recordDate: "2026-01-15", note: "" });
    const summary = importPerformanceFromCsv(
      repo,
      "Date,Account,Value\n2026-01-15,Brokerage,11000.00",
      mapping,
      {},
    );
    expect(summary.skippedCount).toBe(1);
    expect(summary.results[0].reason).toMatch(/Duplicate/);
    expect(listPerformanceRecords(repo, 1)[0].totalValueCents).toBe(999900); // unchanged
  });

  it("skips a row with no account information at all", () => {
    const repo = fakeRepo(sampleAccounts);
    const summary = importPerformanceFromCsv(repo, "Date,Value\n2026-01-15,11000.00", { "0": "date", "1": "totalValue" }, {});
    expect(summary.results[0]).toEqual({ rowNumber: 1, status: "skipped", reason: "Missing account" });
  });
});

describe("buildAccountPerformanceHistory", () => {
  const record = (id: number, accountId: number, recordDate: string, cents: number) => ({
    id,
    accountId,
    recordDate,
    totalValueCents: cents,
    note: "",
    createdAt: "",
    updatedAt: "",
  });

  const fidelity = { id: 1, name: "Fidelity HSA" };
  const chase = { id: 2, name: "Chase Joint" };

  it("unions the dates and keeps each account's values against them", () => {
    const result = buildAccountPerformanceHistory([
      // Quarterly.
      { account: fidelity, history: [record(1, 1, "2026-01-31", 10_000), record(2, 1, "2026-03-31", 12_000)] },
      // Monthly, so February exists for Chase alone.
      {
        account: chase,
        history: [
          record(3, 2, "2026-01-31", 50_000),
          record(4, 2, "2026-02-28", 55_000),
          record(5, 2, "2026-03-31", 60_000),
        ],
      },
    ]);

    expect(result.points.map((point) => point.date)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);

    // February has no Fidelity entry at all — absent, not zero.
    const february = result.points[1];
    expect(february.valueCentsByAccountId).toEqual({ 2: 55_000 });
    expect(1 in february.valueCentsByAccountId).toBe(false);
    expect(february.reportingAccountCount).toBe(1);
    expect(february.totalCents).toBe(55_000);

    expect(result.points[2].totalCents).toBe(72_000);
    expect(result.points[2].reportingAccountCount).toBe(2);
  });

  it("summarizes each account's first and last recorded value", () => {
    const result = buildAccountPerformanceHistory([
      { account: fidelity, history: [record(2, 1, "2026-03-31", 12_500), record(1, 1, "2026-01-31", 10_000)] },
    ]);

    expect(result.series).toHaveLength(1);
    expect(result.series[0]).toMatchObject({
      accountId: 1,
      accountName: "Fidelity HSA",
      recordCount: 2,
      // Sorted regardless of the order the records arrived in.
      firstDate: "2026-01-31",
      lastDate: "2026-03-31",
      firstValueCents: 10_000,
      lastValueCents: 12_500,
      changeCents: 2_500,
    });
    expect(result.series[0].changePct).toBeCloseTo(25, 6);
  });

  it("drops an account with no records rather than charting an empty line", () => {
    const result = buildAccountPerformanceHistory([
      { account: fidelity, history: [record(1, 1, "2026-01-31", 10_000)] },
      { account: chase, history: [] },
    ]);
    expect(result.series.map((entry) => entry.accountId)).toEqual([1]);
  });

  it("reports no change, and no divide by zero, for a single record or a zero start", () => {
    const single = buildAccountPerformanceHistory([
      { account: fidelity, history: [record(1, 1, "2026-01-31", 10_000)] },
    ]);
    expect(single.series[0].changeCents).toBe(0);
    expect(single.series[0].changePct).toBe(0);

    const fromZero = buildAccountPerformanceHistory([
      { account: fidelity, history: [record(1, 1, "2026-01-31", 0), record(2, 1, "2026-02-28", 500)] },
    ]);
    expect(fromZero.series[0].changeCents).toBe(500);
    expect(fromZero.series[0].changePct).toBe(0);
  });

  it("returns nothing at all for no accounts", () => {
    expect(buildAccountPerformanceHistory([])).toEqual({ points: [], series: [] });
  });
});
