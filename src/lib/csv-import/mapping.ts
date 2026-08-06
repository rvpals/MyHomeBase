// Generic, option-aware mapping helpers shared by any importer. Pure — no I/O.
// The domain-specific meaning of a field name lives in each consuming module's
// apply-adapter; these functions just interpret a cell given its options.
import type {
  AccountNameMapping,
  AccountNameMatch,
  ColumnMapping,
  FieldOptions,
  FieldOptionsMap,
} from "./types";

/** One CSV cell resolved to its target field, with that column's options. */
export interface AppliedCell {
  field: string;
  rawValue: string;
  options: FieldOptions;
}

/**
 * Resolves a data record against a column mapping into the list of mapped cells.
 * More than one column may target the same field (e.g. two columns both feeding
 * "tags") — the adapter decides how to merge them. Columns whose index is out of
 * range for this record are skipped.
 */
export function applyMapping(
  record: string[],
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap = {},
): AppliedCell[] {
  const cells: AppliedCell[] = [];
  for (const [columnIndex, field] of Object.entries(columnMapping)) {
    const index = Number(columnIndex);
    if (!Number.isInteger(index) || index < 0 || index >= record.length) continue;
    cells.push({ field, rawValue: record[index], options: fieldOptions[columnIndex] ?? {} });
  }
  return cells;
}

/** One data row paired with where it came from. */
export interface IndexedCsvRow {
  row: string[];
  /** 0-based index into the parsed rows — the key `excludedRowIndexes` and
   *  per-row overrides are stated in. */
  rowIndex: number;
  /** 1-based, matching `ImportRowResult.rowNumber`. Both are carried so no caller
   *  has to remember which convention it's holding and do its own ±1. */
  rowNumber: number;
}

/**
 * The rows an import should actually process, dropping any the user excluded.
 *
 * Crucially this **keeps each surviving row's original number**. Filtering with a
 * plain `.filter()` and then using the array index would renumber everything after
 * the first exclusion, so a later "row 7 was skipped" message would point at the
 * wrong line of the user's file.
 *
 * Excluded rows are dropped entirely rather than reported as skips: a skip is
 * something that surprised the importer, and a row the user deliberately removed
 * isn't. The caller reports the exclusion count separately.
 */
export function selectImportRows(
  rows: string[][],
  excludedRowIndexes: readonly number[] = [],
): IndexedCsvRow[] {
  const excluded = new Set(excludedRowIndexes);
  const selected: IndexedCsvRow[] = [];
  rows.forEach((row, index) => {
    if (!excluded.has(index)) selected.push({ row, rowIndex: index, rowNumber: index + 1 });
  });
  return selected;
}

/**
 * The fixed values a mapping declares, as `field -> literal`.
 *
 * A column whose options carry a non-blank `constantValue` supplies that literal
 * for every row instead of its own cells. This is how a field with no column in the
 * export gets a value at all — map any spare column to it and fix the value, e.g.
 * Type = "ETF" for a file that never says so.
 *
 * Computed once per import rather than per row: the answer depends only on the
 * mapping, and a 34-row file would otherwise rebuild it 34 times.
 *
 * A whitespace-only entry is treated as absent, so clearing the box in the UI
 * genuinely turns the constant off rather than blanking every row. Values that are
 * intentionally padded aren't supported — no importer wants them.
 */
export function constantValuesByField(
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap = {},
): Record<string, string> {
  const constants: Record<string, string> = {};
  for (const [columnIndex, field] of Object.entries(columnMapping)) {
    const value = fieldOptions[columnIndex]?.constantValue?.trim();
    if (value) constants[field] = value;
  }
  return constants;
}

/**
 * Drops any column whose target field isn't in `allowedFields`. Auto-mapping
 * guesses from header text alone and doesn't know which import type it's guessing
 * for, so a positions CSV with a "Value" column can come back mapped to a field
 * only the performance importer understands. Restricting the guess keeps a saved
 * mapping from carrying a target the importer will never read.
 */
export function restrictMapping(
  columnMapping: ColumnMapping,
  allowedFields: readonly string[],
): ColumnMapping {
  const allowed = new Set(allowedFields);
  return Object.fromEntries(
    Object.entries(columnMapping).filter(([, field]) => allowed.has(field)),
  );
}

/**
 * Splits one cell into a list of values. A blank or whitespace delimiter splits
 * on runs of whitespace (e.g. space-separated tags); any other delimiter is used
 * literally (e.g. "," for comma-separated categories). Result values are trimmed
 * and blanks dropped. An undefined delimiter yields the whole cell as one value.
 */
export function splitDelimited(value: string, delimiter?: string): string[] {
  const trimmed = value.trim();
  if (trimmed === "") return [];
  if (delimiter === undefined) return [trimmed];

  const parts = delimiter.trim() === "" ? trimmed.split(/\s+/) : trimmed.split(delimiter);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

const DATE_TOKEN_PATTERN = /^(YYYY|YY|MM|M|DD|D)$/;

/**
 * Parses a date string according to a simple format and returns it as ISO
 * "YYYY-MM-DD". Supported tokens: YYYY, YY (→ 2000+YY), MM/M (month), DD/D (day),
 * separated by any non-alphanumeric characters. Deliberately small — it covers
 * the common export formats (e.g. "M/D/YY", "MM/DD/YYYY", "YYYY-MM-DD") and
 * throws (rather than guessing) on anything it can't line up with the format.
 */
export function parseDateWithFormat(value: string, format: string): string {
  const tokens = format.split(/[^A-Za-z]+/).filter(Boolean);
  const parts = value.trim().split(/[^0-9]+/).filter(Boolean);

  if (tokens.length === 0) throw new Error(`Date format "${format}" has no recognizable tokens.`);
  if (tokens.length !== parts.length) {
    throw new Error(`Date "${value}" does not match format "${format}".`);
  }

  let year: number | undefined;
  let month: number | undefined;
  let day: number | undefined;

  tokens.forEach((token, index) => {
    if (!DATE_TOKEN_PATTERN.test(token)) {
      throw new Error(`Unsupported date token "${token}" in format "${format}".`);
    }
    const numeric = Number(parts[index]);
    if (Number.isNaN(numeric)) throw new Error(`Non-numeric date part "${parts[index]}" in "${value}".`);

    if (token === "YYYY") year = numeric;
    else if (token === "YY") year = 2000 + numeric;
    else if (token === "MM" || token === "M") month = numeric;
    else if (token === "DD" || token === "D") day = numeric;
  });

  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Date format "${format}" must specify a year, month, and day.`);
  }
  if (month < 1 || month > 12) throw new Error(`Month ${month} out of range in "${value}".`);
  if (day < 1 || day > 31) throw new Error(`Day ${day} out of range in "${value}".`);

  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * Picks up to `count` rows at random (without replacement), returned in their
 * original order for readability. The RNG is injectable so tests are
 * deterministic; production uses Math.random. When there are `count` rows or
 * fewer, all rows are returned.
 */
export function sampleRows<Row>(rows: Row[], count: number, random: () => number = Math.random): Row[] {
  if (rows.length <= count) return [...rows];

  // Partial Fisher-Yates over an index array, then sort the chosen indices so
  // the sample preserves document order.
  const indices = rows.map((_, index) => index);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(random() * (indices.length - i));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices
    .slice(0, count)
    .sort((a, b) => a - b)
    .map((index) => rows[index]);
}

/**
 * Turns a saved account-name mapping into the `csvName -> accountId` map an
 * importer wants, against the accounts that exist *now*.
 *
 * A saved match can go stale two ways, and each is recoverable from the other
 * half of the pair: the account was renamed (the id still resolves) or it was
 * deleted and recreated (the id is gone, the name still matches). An entry that
 * resolves neither way is dropped rather than guessed at — the importer then
 * treats that CSV label as unrecognised and asks, which is the honest outcome.
 */
export function resolveAccountNameMapping(
  saved: AccountNameMapping,
  accounts: readonly { id: number; name: string }[],
): Record<string, number> {
  const byId = new Map(accounts.map((account) => [account.id, account]));
  const byName = new Map(accounts.map((account) => [account.name.trim().toLowerCase(), account]));

  const resolved: Record<string, number> = {};
  for (const [csvName, match] of Object.entries(saved)) {
    const account =
      byId.get(match.accountId) ?? byName.get(match.accountName.trim().toLowerCase());
    if (account) resolved[csvName] = account.id;
  }
  return resolved;
}

/**
 * Builds the savable form from what the match dialog produced, pairing each
 * chosen id with that account's current name so the match can survive either
 * being changed later. Ids with no matching account are dropped.
 */
export function toAccountNameMapping(
  chosen: Record<string, number>,
  accounts: readonly { id: number; name: string }[],
): AccountNameMapping {
  const byId = new Map(accounts.map((account) => [account.id, account]));

  const mapping: AccountNameMapping = {};
  for (const [csvName, accountId] of Object.entries(chosen)) {
    const account = byId.get(accountId);
    if (!account) continue;
    const match: AccountNameMatch = { accountId: account.id, accountName: account.name };
    mapping[csvName.trim()] = match;
  }
  return mapping;
}

// A named mapping's JSON column is a widening envelope, which is why adding to
// it has never needed a migration:
//   legacy:  { "0": "ticker", "1": "name" }                    (columns only)
//   +options:{ columns: {...}, options: {...} }
//   current: { columns: {...}, options: {...}, accounts: {...} }
// Every key is read defensively, so a mapping saved under any earlier shape
// still loads and simply reports {} for what it predates.
export function parseStoredMapping(json: string): {
  columnMapping: ColumnMapping;
  fieldOptions: FieldOptionsMap;
  accountNameMapping: AccountNameMapping;
} {
  const parsed = JSON.parse(json) as unknown;
  if (parsed && typeof parsed === "object" && "columns" in parsed) {
    const wrapped = parsed as {
      columns?: ColumnMapping;
      options?: FieldOptionsMap;
      accounts?: AccountNameMapping;
    };
    return {
      columnMapping: wrapped.columns ?? {},
      fieldOptions: wrapped.options ?? {},
      accountNameMapping: wrapped.accounts ?? {},
    };
  }
  return {
    columnMapping: (parsed as ColumnMapping) ?? {},
    fieldOptions: {},
    accountNameMapping: {},
  };
}

export function serializeNamedMapping(
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
  accountNameMapping: AccountNameMapping,
): string {
  return JSON.stringify({
    columns: columnMapping,
    options: fieldOptions,
    accounts: accountNameMapping,
  });
}
