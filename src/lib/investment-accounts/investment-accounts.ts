import { type ColumnMapping, mapRow, parseCsv, parseNumeric, parseDateToIso, summarizeImportResults } from "@/lib/csv-import";
import type { ImportRowResult, ImportSummary } from "@/lib/csv-import";
import type { InvestmentAccountRepository } from "./ports";
import {
  createInvestmentAccountSchema,
  createPerformanceRecordSchema,
  updateInvestmentAccountSchema,
  updatePerformanceRecordSchema,
} from "./schema";
import type {
  CreateInvestmentAccountInput,
  CreatePerformanceRecordInput,
  UpdateInvestmentAccountInput,
  UpdatePerformanceRecordInput,
} from "./schema";
import type { InvestmentAccount, PerformanceRecord } from "./types";

export function listAccounts(repo: InvestmentAccountRepository): InvestmentAccount[] {
  return repo.listAccounts();
}

export function getAccountById(
  repo: InvestmentAccountRepository,
  id: number,
): InvestmentAccount | undefined {
  return repo.getAccountById(id);
}

export function createAccount(
  repo: InvestmentAccountRepository,
  input: CreateInvestmentAccountInput,
): InvestmentAccount {
  const validated = createInvestmentAccountSchema.parse(input);
  return repo.createAccount(validated);
}

export function updateAccount(
  repo: InvestmentAccountRepository,
  id: number,
  input: UpdateInvestmentAccountInput,
): InvestmentAccount {
  const validated = updateInvestmentAccountSchema.parse(input);
  return repo.updateAccount(id, validated);
}

export function deleteAccount(repo: InvestmentAccountRepository, id: number): void {
  repo.deleteAccount(id);
}

export function listPerformanceRecords(
  repo: InvestmentAccountRepository,
  accountId?: number,
): PerformanceRecord[] {
  return repo.listPerformanceRecords(accountId);
}

export function addPerformanceRecord(
  repo: InvestmentAccountRepository,
  input: CreatePerformanceRecordInput,
): PerformanceRecord {
  const validated = createPerformanceRecordSchema.parse(input);
  if (!repo.getAccountById(validated.accountId)) {
    throw new Error(`No investment account with id ${validated.accountId}.`);
  }
  return repo.addPerformanceRecord(validated);
}

export function updatePerformanceRecord(
  repo: InvestmentAccountRepository,
  id: number,
  input: UpdatePerformanceRecordInput,
): PerformanceRecord {
  const validated = updatePerformanceRecordSchema.parse(input);
  return repo.updatePerformanceRecord(id, validated);
}

export function deletePerformanceRecord(repo: InvestmentAccountRepository, id: number): void {
  repo.deletePerformanceRecord(id);
}

/** Distinct, trimmed account-name values from a CSV's mapped "accountName" column, sorted. */
export function extractCsvAccountNames(fileText: string, columnMapping: ColumnMapping): string[] {
  const accountNameColumn = Object.entries(columnMapping).find(([, field]) => field === "accountName")?.[0];
  if (accountNameColumn === undefined) return [];

  const { rows } = parseCsv(fileText);
  const names = new Set<string>();
  for (const row of rows) {
    const value = row[Number(accountNameColumn)]?.trim();
    if (value) names.add(value);
  }
  return [...names].sort();
}

/**
 * Inserts performance records from a CSV, skipping duplicates (same account
 * + date) instead of overwriting a value that's already recorded. Account
 * names are resolved via an explicit CSV-name -> account-id mapping first
 * (from the account-matching dialog), falling back to a case-insensitive
 * exact match against existing account names.
 */
export function importPerformanceFromCsv(
  repo: InvestmentAccountRepository,
  fileText: string,
  columnMapping: ColumnMapping,
  accountNameMapping: Record<string, number>,
): ImportSummary {
  const { rows } = parseCsv(fileText);
  const accounts = repo.listAccounts();

  const results: ImportRowResult[] = rows.map((row, index) => {
    const rowNumber = index + 1;
    const record = mapRow(row, columnMapping);

    let accountId: number | undefined;
    const rawAccountId = parseNumeric(record.accountId);
    if (rawAccountId > 0) {
      accountId = rawAccountId;
    } else if (record.accountName?.trim()) {
      const csvName = record.accountName.trim();
      accountId =
        accountNameMapping[csvName] ??
        accounts.find((account) => account.name.toLowerCase() === csvName.toLowerCase())?.id;
      if (accountId === undefined) {
        return { rowNumber, status: "skipped", reason: `No matching account for "${csvName}"` };
      }
    } else {
      return { rowNumber, status: "skipped", reason: "Missing account" };
    }

    if (!repo.getAccountById(accountId)) {
      return { rowNumber, status: "skipped", reason: `Account ${accountId} not found` };
    }

    try {
      const validated = createPerformanceRecordSchema.parse({
        accountId,
        totalValueCents: Math.round(parseNumeric(record.totalValue) * 100),
        recordDate: parseDateToIso(record.date),
        note: record.note ?? "",
      });
      const { inserted } = repo.addPerformanceRecordIfNotExists(validated);
      return inserted
        ? { rowNumber, status: "imported" }
        : { rowNumber, status: "skipped", reason: "Duplicate of an existing performance record" };
    } catch (error) {
      return { rowNumber, status: "skipped", reason: error instanceof Error ? error.message : "Invalid row" };
    }
  });

  return summarizeImportResults(results);
}
