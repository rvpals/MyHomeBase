// Expense-specific CSV import: maps a credit-card statement row onto a
// transaction. The generic machinery (record parsing, column mapping, delimiters,
// date formats, named mappings per card company) lives in @/lib/csv-import; this
// adapter knows what an expense field means.

import {
  applyMapping,
  parseCsvRecords,
  parseDateWithFormat,
  summarizeImportResults,
} from "@/lib/csv-import";
import type {
  ColumnMapping,
  FieldOptionsMap,
  ImportRowResult,
  ImportSummary,
} from "@/lib/csv-import";
import { createTransaction } from "./expense";
import type { ExpenseRepository } from "./ports";
import { planRuleApplication } from "./rules";
import type { SaveTransactionInput } from "./schema";

/** The expense fields a CSV column can be mapped to, for the mapping UI. */
export const EXPENSE_IMPORT_FIELDS = [
  { value: "transactionDate", label: "Transaction date" },
  { value: "postingDate", label: "Posting date" },
  { value: "transactionDescription", label: "Description (vendor)" },
  { value: "amount", label: "Amount" },
  { value: "debit", label: "Amount — debit column" },
  { value: "credit", label: "Amount — credit column" },
  { value: "categoryName", label: "Category" },
  { value: "note", label: "Note" },
] as const;

const DEFAULT_DATE_FORMAT = "MM/DD/YYYY";

/**
 * Reads a money cell into cents. Handles the shapes card exports actually use:
 * `$20.33`, `1,234.56`, `(45.00)` for negatives, and a trailing minus. Returns
 * undefined for a blank or unreadable cell so the caller can decide.
 */
export function parseMoneyToCents(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  const isParenthesised = /^\(.*\)$/.test(trimmed);
  const hasTrailingMinus = /-$/.test(trimmed);
  const cleaned = trimmed.replace(/[()$£€,\s]/g, "").replace(/-$/, "");

  const amount = Number.parseFloat(cleaned);
  if (Number.isNaN(amount)) return undefined;

  const sign = isParenthesised || hasTrailingMinus ? -1 : 1;
  return Math.round(amount * 100) * sign;
}

export interface ExpenseImportOptions {
  /** The card this statement belongs to. */
  transactionAccountId: number;
  /**
   * Flip the sign of every amount. Card exports disagree: some write purchases
   * as positive, others as negative. The app's convention is charges positive.
   */
  invertAmounts?: boolean;
  /** Skip rows that already exist for this account. Default true. */
  skipDuplicates?: boolean;
  /** Auto-categorise new rows using the saved rules. Default true. */
  applyRules?: boolean;
}

export interface ExpenseImportSummary extends ImportSummary {
  duplicateCount: number;
  categorisedCount: number;
}

function recordToTransaction(
  record: string[],
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
  options: ExpenseImportOptions,
): SaveTransactionInput {
  let transactionDate: string | undefined;
  let postingDate = "";
  let transactionDescription = "";
  let categoryName = "";
  let note = "";
  let amountCents: number | undefined;
  let debitCents: number | undefined;
  let creditCents: number | undefined;

  for (const cell of applyMapping(record, columnMapping, fieldOptions)) {
    const value = cell.rawValue.trim();
    switch (cell.field) {
      case "transactionDate":
        if (value !== "") {
          transactionDate = parseDateWithFormat(value, cell.options.dateFormat ?? DEFAULT_DATE_FORMAT);
        }
        break;
      case "postingDate":
        if (value !== "") {
          postingDate = parseDateWithFormat(value, cell.options.dateFormat ?? DEFAULT_DATE_FORMAT);
        }
        break;
      case "transactionDescription":
        transactionDescription = value;
        break;
      case "categoryName":
        categoryName = value;
        break;
      case "note":
        note = value;
        break;
      case "amount":
        amountCents = parseMoneyToCents(value);
        break;
      case "debit":
        debitCents = parseMoneyToCents(value);
        break;
      case "credit":
        creditCents = parseMoneyToCents(value);
        break;
      default:
        break;
    }
  }

  if (!transactionDate) throw new Error("no transaction date mapped, or the cell was empty");

  // Separate debit/credit columns: a debit is a charge (positive), a credit is
  // money coming back (negative). Only one of the two is filled on a given row.
  if (amountCents === undefined) {
    if (debitCents !== undefined) amountCents = Math.abs(debitCents);
    else if (creditCents !== undefined) amountCents = -Math.abs(creditCents);
  }
  if (amountCents === undefined) throw new Error("no amount could be read from this row");

  return {
    transactionDate,
    postingDate,
    transactionAccountId: options.transactionAccountId,
    transactionDescription,
    categoryName,
    amountCents: options.invertAmounts ? -amountCents : amountCents,
    note,
    status: "new",
  };
}

/**
 * Imports statement rows for one card. Best-effort: each row is handled
 * independently and failures are reported rather than aborting the run.
 * Duplicates (same account, date, description and amount) are skipped by
 * default, so re-importing an overlapping statement is safe.
 */
export function importExpenseCsv(
  repo: ExpenseRepository,
  fileText: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
  options: ExpenseImportOptions,
  createdByUserId: number,
): ExpenseImportSummary {
  // Checked once up front rather than per row, so a wrong account fails with one
  // clear error instead of the same message repeated for every line.
  if (!repo.getAccountById(options.transactionAccountId)) {
    throw new Error(`No credit-card account with id ${options.transactionAccountId}.`);
  }

  const skipDuplicates = options.skipDuplicates ?? true;
  const shouldApplyRules = options.applyRules ?? true;
  const rules = shouldApplyRules ? repo.listRules() : [];

  const dataRecords = parseCsvRecords(fileText).slice(1); // drop the header row
  const results: ImportRowResult[] = [];
  let duplicateCount = 0;
  let categorisedCount = 0;

  dataRecords.forEach((record, index) => {
    const rowNumber = index + 2; // 1-based, +1 for the header
    if (record.every((cell) => cell.trim() === "")) return;

    try {
      const input = recordToTransaction(record, columnMapping, fieldOptions, options);

      if (
        skipDuplicates &&
        repo.transactionExists({
          transactionAccountId: input.transactionAccountId,
          transactionDate: input.transactionDate,
          transactionDescription: input.transactionDescription ?? "",
          amountCents: input.amountCents,
        })
      ) {
        duplicateCount += 1;
        results.push({ rowNumber, status: "skipped", reason: "already imported" });
        return;
      }

      // Rules run before the insert so the row lands categorised in one write.
      let categoryName = input.categoryName ?? "";
      let status = input.status ?? "new";
      if (shouldApplyRules && categoryName === "") {
        const plan = planRuleApplication(
          {
            transactionDescription: input.transactionDescription ?? "",
            categoryName: "",
            status: "new",
          },
          rules,
        );
        if (plan) {
          categoryName = plan.categoryName;
          status = plan.status;
          categorisedCount += 1;
        }
      }

      // Through the use-case, so the row gets the same validation and
      // category registration as one typed in by hand.
      createTransaction(repo, { ...input, categoryName, status }, createdByUserId);
      results.push({ rowNumber, status: "imported" });
    } catch (error) {
      results.push({
        rowNumber,
        status: "skipped",
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }
  });

  return { ...summarizeImportResults(results), duplicateCount, categorisedCount };
}
