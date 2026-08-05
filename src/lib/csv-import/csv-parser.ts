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
  Brokerage: "brokerageFirm",
  Broker: "brokerageFirm",
  "Brokerage Firm": "brokerageFirm",
  Firm: "brokerageFirm",
  "Reference Number": "externalId",
  "Confirmation Number": "externalId",
  "Transaction ID": "externalId",
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

  // Cost basis / identifiers / classification, as spelled by J.P. Morgan Chase,
  // Fidelity and Schwab position exports.
  Cost: "cost",
  "Cost Basis": "cost",
  "Total Cost": "cost",
  "Unit Cost": "unitCost",
  "Average Cost Basis": "unitCost",
  "Cost Basis Per Share": "unitCost",
  "Unrealized G/L Amt.": "unrealizedGainLoss",
  "Unrealized Gain/Loss": "unrealizedGainLoss",
  "Total Gain/Loss Dollar": "unrealizedGainLoss",
  "Unrealized Gain/Loss (%)": "unrealizedGainLossPct",
  "Total Gain/Loss Percent": "unrealizedGainLossPct",
  "Today's Value Change": "dayGainLoss",
  "Day Gain/Loss": "dayGainLoss",
  "Est. Annual Income": "estAnnualIncome",
  "Estimated Annual Income": "estAnnualIncome",
  "Accrued/Income Earned": "incomeEarned",
  CUSIP: "cusip",
  ISIN: "isin",
  "Asset Class": "assetClass",
  "Asset Strategy": "assetStrategy",
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
