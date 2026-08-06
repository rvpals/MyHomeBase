import {
  type ColumnMapping,
  constantValuesByField,
  mapRow,
  parseCsv,
  parseNumeric,
  parseDateToIso,
  selectImportRows,
  summarizeImportResults,
} from "@/lib/csv-import";
import type { FieldOptionsMap, ImportRowResult, ImportSummary } from "@/lib/csv-import";
import { decodeImageUpload, type ImageUploadInput } from "@/lib/shared/image-upload";
import type { InvestmentAccountRepository } from "./ports";
import {
  MAX_ACCOUNT_ICON_BYTES,
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
import type {
  AccountIcon,
  AccountPerformanceHistory,
  AccountPerformancePoint,
  AccountPerformanceSeries,
  InvestmentAccount,
  PerformanceRecord,
} from "./types";

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

/**
 * Stores the icon shown beside an account. The account must already exist —
 * creating one as a side effect of an upload would let a stale id add an account
 * nobody asked for.
 */
export function setAccountIcon(
  repo: InvestmentAccountRepository,
  id: number,
  input: ImageUploadInput,
): void {
  if (!repo.getAccountById(id)) throw new Error(`No investment account with id ${id}.`);
  repo.setAccountIcon(id, decodeImageUpload(input, MAX_ACCOUNT_ICON_BYTES));
}

/** Removes an account's icon, leaving the account itself untouched. */
export function clearAccountIcon(repo: InvestmentAccountRepository, id: number): void {
  if (!repo.getAccountById(id)) throw new Error(`No investment account with id ${id}.`);
  repo.setAccountIcon(id, undefined);
}

/** Used only by the icon-serving route — never by anything rendering a list. */
export function getAccountIcon(
  repo: InvestmentAccountRepository,
  id: number,
): AccountIcon | undefined {
  return repo.getAccountIcon(id);
}

/** The fields an Account Performance CSV column can be mapped to. */
export const PERFORMANCE_IMPORT_FIELDS: readonly { value: string; label: string }[] = [
  { value: "date", label: "Date" },
  { value: "accountName", label: "Account name" },
  { value: "accountId", label: "Account ID" },
  { value: "totalValue", label: "Total value ($)" },
  { value: "note", label: "Note" },
];

/** Distinct, trimmed account-name values from a CSV's mapped "accountName" column, sorted. */
export function extractCsvAccountNames(fileText: string, columnMapping: ColumnMapping): string[] {
  const accountNameColumn = Object.entries(columnMapping).find(
    ([, field]) => field === "accountName",
  )?.[0];
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
  fieldOptions: FieldOptionsMap = {},
  excludedRowIndexes: readonly number[] = [],
): ImportSummary {
  const { rows } = parseCsv(fileText);
  const accounts = repo.listAccounts();
  // Fixed values override whatever the mapped cell said, so they're spread last.
  const constants = constantValuesByField(columnMapping, fieldOptions);

  const results: ImportRowResult[] = selectImportRows(rows, excludedRowIndexes).map(
    ({ row, rowNumber }) => {
      const record = { ...mapRow(row, columnMapping), ...constants };

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
        return {
          rowNumber,
          status: "skipped",
          reason: error instanceof Error ? error.message : "Invalid row",
        };
      }
    },
  );

  return summarizeImportResults(results);
}

/**
 * Aligns every account's performance records onto one date axis for the
 * combined chart and its table.
 *
 * Accounts are recorded on their own schedules — a 401k quarterly, a brokerage
 * monthly — so the axis is the union of every date anyone recorded, and an
 * account simply has no entry on a date it didn't report. That absence is
 * preserved rather than filled: a zero would read as "the account was empty",
 * and carrying the previous value forward would assert a balance on a day it
 * was never checked. The chart draws a line across the gap, which is a visible
 * interpolation; the data underneath stays honest about what was recorded.
 *
 * Accounts with no records at all are dropped — there is no line to draw and a
 * dead entry in the legend is just noise.
 */
export function buildAccountPerformanceHistory(
  entries: readonly {
    account: Pick<InvestmentAccount, "id" | "name">;
    history: readonly PerformanceRecord[];
  }[],
): AccountPerformanceHistory {
  const byDate = new Map<string, Record<number, number>>();

  const series: AccountPerformanceSeries[] = [];
  for (const { account, history } of entries) {
    if (history.length === 0) continue;

    const ordered = [...history].sort((a, b) => a.recordDate.localeCompare(b.recordDate));
    for (const record of ordered) {
      const forDate = byDate.get(record.recordDate) ?? {};
      // Last write wins if a date somehow holds two records for one account —
      // the repository upserts on (accountId, recordDate), so this is defensive.
      forDate[account.id] = record.totalValueCents;
      byDate.set(record.recordDate, forDate);
    }

    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const changeCents = last.totalValueCents - first.totalValueCents;
    series.push({
      accountId: account.id,
      accountName: account.name,
      recordCount: ordered.length,
      firstDate: first.recordDate,
      lastDate: last.recordDate,
      firstValueCents: first.totalValueCents,
      lastValueCents: last.totalValueCents,
      changeCents,
      changePct:
        first.totalValueCents > 0 ? (changeCents / first.totalValueCents) * 100 : 0,
    });
  }

  const points: AccountPerformancePoint[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, valueCentsByAccountId]) => {
      const values = Object.values(valueCentsByAccountId);
      return {
        date,
        valueCentsByAccountId,
        totalCents: values.reduce((sum, value) => sum + value, 0),
        reportingAccountCount: values.length,
      };
    });

  return { points, series };
}
