// Broker-specific header aliasing/date-numeric parsing for the Stocks & ETFs CSV
// importer. Generic CSV line/text splitting lives in @/lib/shared/csv — re-exported
// below so this module's existing public surface doesn't change.
import { parseCsv, parseCsvLine, type ParsedCsv } from "@/lib/shared/csv";
import type { ColumnMapping } from "./types";

export { parseCsv, parseCsvLine, type ParsedCsv };

/** Strips currency symbols/commas and parses a number, defaulting to 0 for anything unparseable. */
export function parseNumeric(value: string | undefined): number {
  if (value == null || value === "") return 0;
  return parseFloat(value.replace(/[$,]/g, "")) || 0;
}

const HEADER_ALIASES: Record<string, string> = {
  Symbol: "ticker",
  Ticker: "ticker",
  SYMBOL: "ticker",
  Description: "name",
  Name: "name",
  Company: "name",
  Security: "name",
  Price: "currentPrice",
  "Last Price": "currentPrice",
  "Current Price": "currentPrice",
  Last: "currentPrice",
  Shares: "quantity",
  Quantity: "quantity",
  Qty: "quantity",
  Units: "quantity",
  Type: "type",
  "Asset Type": "type",
  "Security Type": "type",
  Date: "date",
  "Trade Date": "date",
  "Transaction Date": "date",
  Action: "action",
  "Transaction Type": "action",
  "Trans Type": "action",
  Amount: "totalAmount",
  Total: "totalAmount",
  "Total Amount": "totalAmount",
  Note: "note",
  Notes: "note",
  Memo: "note",
  Account: "accountName",
  "Account Name": "accountName",
  account: "accountName",
  "account name": "accountName",
  "Total Value": "totalValue",
  Value: "totalValue",
  "Market Value": "totalValue",
};

/** Best-effort column-index -> field-name guess from common header spellings. */
export function autoMapHeaders(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  headers.forEach((header, index) => {
    const alias = HEADER_ALIASES[header.trim()];
    if (alias) mapping[String(index)] = alias;
  });
  return mapping;
}

/** Applies a column mapping to one data row, producing a field-name-keyed record. */
export function mapRow(row: string[], mapping: ColumnMapping): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [columnIndex, fieldName] of Object.entries(mapping)) {
    const index = Number(columnIndex);
    if (index >= 0 && index < row.length) record[fieldName] = row[index];
  }
  return record;
}

/** Parses a free-form date string to an ISO "YYYY-MM-DD" date, falling back to today when unparseable. */
export function parseDateToIso(dateStr: string | undefined): string {
  const today = new Date().toISOString().slice(0, 10);
  if (!dateStr) return today;
  const parsed = new Date(dateStr);
  return Number.isNaN(parsed.getTime()) ? today : parsed.toISOString().slice(0, 10);
}
