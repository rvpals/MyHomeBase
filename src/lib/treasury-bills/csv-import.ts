// T-Bill-specific CSV import: turns a mapped CSV record into a createPurchase call.
// The generic mapping machinery (parsing, mapRow, constants, date formats) lives in
// @/lib/csv-import; this adapter knows what each T-Bill field means.
//
// Modelled on src/lib/investment-accounts' performance importer, deliberately: it is
// the simplest of the three the Investments CSV Import screen already offers, and
// this is the fourth type on that same screen rather than a new one.
import {
  constantValuesByField,
  mapRow,
  parseCsv,
  parseDateWithFormat,
  parseNumeric,
  selectImportRows,
  summarizeImportResults,
} from "@/lib/csv-import";
import type {
  ColumnMapping,
  FieldOptions,
  FieldOptionsMap,
  ImportRowResult,
  ImportSummary,
} from "@/lib/csv-import";
import { symbolDateKey } from "./match-key";
import type { TBillRepository } from "./ports";
import { createTBillPurchaseSchema } from "./schema";
import type { CreateTBillPurchaseInput } from "./schema";

/**
 * The T-Bill fields a CSV column can be mapped to.
 *
 * In the lib, not the view, so the importer and the mapping dropdown cannot
 * disagree about what is importable.
 */
export const TBILL_IMPORT_FIELDS: readonly { value: string; label: string }[] = [
  { value: "symbol", label: "Symbol" },
  { value: "description", label: "Description" },
  { value: "datePurchased", label: "Date purchased" },
  { value: "sharesPurchased", label: "Shares purchased" },
  { value: "purchasePrice", label: "Purchase price (per $100 face)" },
  { value: "amountSpent", label: "Amount spent ($)" },
  { value: "datePayout", label: "Date payout" },
  { value: "payoutAmount", label: "Payout amount ($)" },
];

/**
 * Fields whose column needs a source date format control.
 *
 * Broker exports write these as `M/D/YYYY` as often as ISO, and a misread date
 * silently changes the computed term and therefore the yield.
 */
export const TBILL_DATE_FIELDS = ["datePurchased", "datePayout"] as const;

/**
 * The options a freshly-mapped column starts with.
 *
 * The mapping UI must **write** these into its field options rather than only
 * displaying them: a `select`'s rendered value fires no change event, so a default
 * that lives in the control alone is invisible to the import.
 */
export function defaultTbillFieldOptions(field: string): FieldOptions | undefined {
  return (TBILL_DATE_FIELDS as readonly string[]).includes(field)
    ? { dateFormat: "YYYY-MM-DD" }
    : undefined;
}

// Header (lower-cased) -> T-Bill field. Headers not listed are left unmapped for the
// reader to map by hand — the importer never guesses. Spelled out as a lookup table
// rather than stemmed, so it can be read at a glance.
const TBILL_HEADER_RULES: Record<string, string> = {
  symbol: "symbol",
  "symbol in system": "symbol",
  cusip: "symbol",
  ticker: "symbol",
  description: "description",
  "symbol description": "description",
  "security description": "description",
  name: "description",
  "date purchased": "datePurchased",
  "purchase date": "datePurchased",
  "trade date": "datePurchased",
  "settlement date": "datePurchased",
  "share purchased": "sharesPurchased",
  "shares purchased": "sharesPurchased",
  shares: "sharesPurchased",
  quantity: "sharesPurchased",
  qty: "sharesPurchased",
  "purchase price": "purchasePrice",
  price: "purchasePrice",
  "price per share": "purchasePrice",
  "amount spent": "amountSpent",
  "total amount spent": "amountSpent",
  amount: "amountSpent",
  cost: "amountSpent",
  "total cost": "amountSpent",
  principal: "amountSpent",
  "date payout": "datePayout",
  "payout date": "datePayout",
  "maturity date": "datePayout",
  maturity: "datePayout",
  "date matured": "datePayout",
  "payout amount": "payoutAmount",
  "maturity amount": "payoutAmount",
  "face value": "payoutAmount",
  proceeds: "payoutAmount",
};

/**
 * Best-effort auto-mapping for common broker headers: the column mapping and the
 * per-column options implied by recognised header names. Unknown headers are
 * skipped. Seeds both the CLI and the mapping UI's starting point.
 */
export function autoMapTbillHeaders(headers: string[]): {
  columnMapping: ColumnMapping;
  fieldOptions: FieldOptionsMap;
} {
  const columnMapping: ColumnMapping = {};
  const fieldOptions: FieldOptionsMap = {};
  headers.forEach((header, index) => {
    const field = TBILL_HEADER_RULES[header.trim().toLowerCase()];
    if (!field) return;
    columnMapping[String(index)] = field;
    const options = defaultTbillFieldOptions(field);
    if (options) fieldOptions[String(index)] = options;
  });
  return { columnMapping, fieldOptions };
}

/** What a planned row would do. `skip` is a duplicate or an unusable row. */
export type TBillImportAction = "create" | "skip";

export interface TBillImportPlanRow {
  /** 1-based row number in the file; the header is row 1. */
  rowNumber: number;
  action: TBillImportAction;
  symbol: string;
  datePurchased: string;
  /** Why, when the action is `skip`. */
  reason?: string;
}

export interface TBillImportPlan {
  rows: TBillImportPlanRow[];
  createCount: number;
  skipCount: number;
}

export interface TBillImportOptions {
  fieldOptions?: FieldOptionsMap;
  /** Row indexes (0-based over the file's data rows) the reader unticked in the grid. */
  excludedRowIndexes?: readonly number[];
  /** On by default, so re-importing the same file is a no-op. */
  skipDuplicates?: boolean;
}

/**
 * A date cell that must actually be a date, or the row is refused.
 *
 * Deliberately **not** the shared `parseDateToIso`, which falls back to *today* for a
 * blank or unparseable cell. That default is survivable where a date is incidental; it
 * is not here. Both of a bill's dates are load-bearing — their difference is the term,
 * and the term divides into the yield — so a file whose date column is misread would
 * import rows that look deliberate and carry a silently wrong yield. Refusing the row
 * puts it in the summary with its file row number instead, which is the convention
 * every importer here follows for a bad row.
 */
function parseRequiredDate(
  value: string | undefined,
  format: string | undefined,
  label: string,
): string {
  const raw = (value ?? "").trim();
  if (!raw) throw new Error(`Missing ${label}.`);

  // An explicit format wins, and `parseDateWithFormat` already throws a sentence
  // naming the value and the format when they disagree.
  if (format) return parseDateWithFormat(raw, format);

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Could not read "${raw}" as a ${label}.`);
  }
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(parsed.getFullYear(), 4)}-${pad(parsed.getMonth() + 1, 2)}-${pad(parsed.getDate(), 2)}`;
}

/**
 * Turns one mapped record into a create input, or throws with a readable reason.
 *
 * The single place a CSV cell becomes a purchase. The plan, the preview and the real
 * import all call it, which is what stops the confirmation from describing something
 * different to what the run then does.
 */
function recordToPurchaseInput(
  record: Record<string, string>,
  fieldOptions: FieldOptionsMap,
  columnMapping: ColumnMapping,
): CreateTBillPurchaseInput {
  const dateFormatFor = (field: string): string | undefined => {
    const column = Object.entries(columnMapping).find(([, mapped]) => mapped === field)?.[0];
    return column === undefined ? undefined : fieldOptions[column]?.dateFormat;
  };

  return createTBillPurchaseSchema.parse({
    symbol: (record.symbol ?? "").trim(),
    description: record.description ?? "",
    datePurchased: parseRequiredDate(
      record.datePurchased,
      dateFormatFor("datePurchased"),
      "date purchased",
    ),
    datePayout: parseRequiredDate(record.datePayout, dateFormatFor("datePayout"), "date payout"),
    sharesPurchased: parseNumeric(record.sharesPurchased),
    purchasePrice: parseNumeric(record.purchasePrice),
    amountSpentCents: Math.round(parseNumeric(record.amountSpent) * 100),
    payoutAmountCents: Math.round(parseNumeric(record.payoutAmount) * 100),
  });
}

/**
 * Decides every row once, for both `planTbillImport` and `importTbillCsv`.
 *
 * Two separate implementations drift, and the drift shows up as a confirmation that
 * lies about what the import then does — so there is exactly one walk, and the two
 * public functions differ only in what they do with each decision.
 *
 * The stored duplicate counts are read **once, before** the walk; rows this run
 * inserts are counted separately in `seenByKey`, so the second legitimate identical
 * row in one file is not mistaken for a duplicate of the first.
 */
function walkTbillCsv(
  repo: TBillRepository,
  fileText: string,
  columnMapping: ColumnMapping,
  options: TBillImportOptions,
  onRow: (decision: {
    rowNumber: number;
    action: TBillImportAction;
    symbol: string;
    datePurchased: string;
    reason?: string;
    input?: CreateTBillPurchaseInput;
  }) => void,
): void {
  const { fieldOptions = {}, excludedRowIndexes = [], skipDuplicates = true } = options;
  const { rows } = parseCsv(fileText);
  // Fixed values override whatever the mapped cell said, so they are spread last.
  const constants = constantValuesByField(columnMapping, fieldOptions);

  const storedByKey = repo.countsBySymbolAndDate();
  const seenByKey = new Map<string, number>();

  for (const { row, rowNumber } of selectImportRows(rows, excludedRowIndexes)) {
    const record = { ...mapRow(row, columnMapping), ...constants };

    let input: CreateTBillPurchaseInput;
    try {
      input = recordToPurchaseInput(record, fieldOptions, columnMapping);
    } catch (error) {
      onRow({
        rowNumber,
        action: "skip",
        symbol: (record.symbol ?? "").trim(),
        datePurchased: (record.datePurchased ?? "").trim(),
        reason: error instanceof Error ? error.message : "Invalid row",
      });
      continue;
    }

    const key = symbolDateKey(input.symbol, input.datePurchased);
    const seen = seenByKey.get(key) ?? 0;
    const stored = storedByKey.get(key) ?? 0;

    if (skipDuplicates && seen < stored) {
      // This file's Nth copy of the key is already stored. Counted as seen so the
      // file's *next* copy is measured against the remaining stored rows.
      seenByKey.set(key, seen + 1);
      onRow({
        rowNumber,
        action: "skip",
        symbol: input.symbol,
        datePurchased: input.datePurchased,
        reason: "Already recorded (same symbol and purchase date)",
        input,
      });
      continue;
    }

    seenByKey.set(key, seen + 1);
    onRow({
      rowNumber,
      action: "create",
      symbol: input.symbol,
      datePurchased: input.datePurchased,
      input,
    });
  }
}

/** What the import would do, without doing any of it. */
export function planTbillImport(
  repo: TBillRepository,
  fileText: string,
  columnMapping: ColumnMapping,
  options: TBillImportOptions = {},
): TBillImportPlan {
  const rows: TBillImportPlanRow[] = [];
  walkTbillCsv(repo, fileText, columnMapping, options, (decision) => {
    rows.push({
      rowNumber: decision.rowNumber,
      action: decision.action,
      symbol: decision.symbol,
      datePurchased: decision.datePurchased,
      reason: decision.reason,
    });
  });
  return {
    rows,
    createCount: rows.filter((row) => row.action === "create").length,
    skipCount: rows.filter((row) => row.action === "skip").length,
  };
}

/** One row of the "what would be stored" preview. */
export interface TBillTestRow {
  rowNumber: number;
  ok: boolean;
  reason?: string;
  values?: Record<string, string>;
}

/**
 * What the selected rows would be stored as.
 *
 * Takes **no repository**, so it cannot write, and is built on the same
 * `recordToPurchaseInput` the import uses — a second parser written for the preview
 * is free to disagree with the one that writes.
 */
export function testTbillImport(
  fileText: string,
  columnMapping: ColumnMapping,
  options: Pick<TBillImportOptions, "fieldOptions" | "excludedRowIndexes"> = {},
): TBillTestRow[] {
  const { fieldOptions = {}, excludedRowIndexes = [] } = options;
  const { rows } = parseCsv(fileText);
  const constants = constantValuesByField(columnMapping, fieldOptions);

  return selectImportRows(rows, excludedRowIndexes).map(({ row, rowNumber }) => {
    const record = { ...mapRow(row, columnMapping), ...constants };
    try {
      const input = recordToPurchaseInput(record, fieldOptions, columnMapping);
      return {
        rowNumber,
        ok: true,
        values: {
          Symbol: input.symbol,
          "Date purchased": input.datePurchased,
          "Date payout": input.datePayout,
          Shares: String(input.sharesPurchased),
          Price: String(input.purchasePrice),
          "Amount spent": (input.amountSpentCents / 100).toFixed(2),
          "Payout amount": (input.payoutAmountCents / 100).toFixed(2),
        },
      };
    } catch (error) {
      return {
        rowNumber,
        ok: false,
        reason: error instanceof Error ? error.message : "Invalid row",
      };
    }
  });
}

/**
 * Imports T-Bill purchases from a CSV.
 *
 * Idempotent by default: a row whose `(symbol, purchase date)` is already stored is
 * skipped and reported, so re-importing the same export does nothing. A bad row is
 * skipped and reported with its file row number — never fatal, never silent.
 */
export function importTbillCsv(
  repo: TBillRepository,
  fileText: string,
  columnMapping: ColumnMapping,
  options: TBillImportOptions = {},
): ImportSummary {
  const results: ImportRowResult[] = [];

  walkTbillCsv(repo, fileText, columnMapping, options, (decision) => {
    if (decision.action === "skip" || !decision.input) {
      results.push({
        rowNumber: decision.rowNumber,
        status: "skipped",
        reason: decision.reason ?? "Skipped",
      });
      return;
    }
    try {
      repo.createPurchase(decision.input);
      results.push({ rowNumber: decision.rowNumber, status: "imported" });
    } catch (error) {
      results.push({
        rowNumber: decision.rowNumber,
        status: "skipped",
        reason: error instanceof Error ? error.message : "Could not store the row",
      });
    }
  });

  return summarizeImportResults(results);
}
