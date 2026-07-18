import { describe, expect, it } from "vitest";
import {
  addPerformanceRecord,
  createAccount,
  deleteAccount,
  deletePerformanceRecord,
  extractCsvAccountNames,
  getAccountById,
  importPerformanceFromCsv,
  listAccounts,
  listPerformanceRecords,
  updateAccount,
  updatePerformanceRecord,
} from "./investment-accounts";
import type { InvestmentAccountRepository } from "./ports";
import type {
  CreateInvestmentAccountInput,
  CreatePerformanceRecordInput,
  UpdateInvestmentAccountInput,
} from "./schema";
import type { InvestmentAccount, PerformanceRecord } from "./types";

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
