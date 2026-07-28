// Generic, option-aware mapping helpers shared by any importer. Pure — no I/O.
// The domain-specific meaning of a field name lives in each consuming module's
// apply-adapter; these functions just interpret a cell given its options.
import type { ColumnMapping, FieldOptions, FieldOptionsMap } from "./types";

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
