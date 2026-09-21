// Pure — no I/O. Everything here works on text a caller already read.
//
// `@/lib/shared/csv` parses comma-separated text and nothing else, which is
// right for the importers that use it: a broker export is always a CSV. This
// screen accepts `.txt` and `.tsv` too, where the separator is genuinely
// unknown until the file is looked at, so the delimiter has to be decided
// before that parser can be reused. Splitting the sniffing out here keeps the
// shared parser unchanged and makes the guess testable on its own.

/** The separators this tool can read. */
export const CSV_DELIMITERS = [",", "\t", ";", "|"] as const;

export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/** How each one is written in a picker, since three of the four are invisible. */
export const DELIMITER_LABELS: Record<CsvDelimiter, string> = {
  ",": "Comma",
  "\t": "Tab",
  ";": "Semicolon",
  "|": "Pipe",
};

/** The separator assumed when a file gives nothing to go on. */
export const DEFAULT_DELIMITER: CsvDelimiter = ",";

/**
 * How many lines the sniffer reads before deciding.
 *
 * A guess made on the header alone is wrong often enough to matter — a
 * one-column header with a comma in its text ("Name, first") outvotes the tabs
 * that actually separate the data. Looking at a handful of lines and preferring
 * the separator that appears *consistently* fixes that, and twenty is well
 * inside what a file's first read already has in memory.
 */
const SNIFF_LINE_LIMIT = 20;

/**
 * The delimiter a text file appears to use.
 *
 * Scored per candidate over the first few non-blank lines: a real separator
 * splits every line into the *same* number of fields, so consistency is worth
 * more than raw frequency. That is what tells a tab-separated file whose values
 * contain commas from a comma-separated one.
 *
 * Counting ignores anything inside double quotes, because a quoted field is
 * exactly where a stray delimiter lives. Without that, one quoted `"Smith,
 * John"` in a semicolon file is enough to swing the guess to comma.
 *
 * Falls back to a comma when nothing scores — a single-column file has no
 * separator to find, and every candidate is equally right.
 */
export function sniffDelimiter(text: string): CsvDelimiter {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, SNIFF_LINE_LIMIT);

  if (lines.length === 0) return DEFAULT_DELIMITER;

  let best: CsvDelimiter = DEFAULT_DELIMITER;
  let bestScore = 0;

  for (const candidate of CSV_DELIMITERS) {
    const counts = lines.map((line) => countOutsideQuotes(line, candidate));
    // A candidate that never appears is not a separator, whatever its
    // consistency: zero on every line is perfectly consistent and perfectly
    // wrong.
    if (counts[0] === 0) continue;

    const consistent = counts.filter((count) => count === counts[0]).length;
    // Consistency first, then how many fields it yields — so a delimiter that
    // splits every line into eight beats one that splits every line into two.
    const score = consistent * 1000 + counts[0];
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

/** Occurrences of `delimiter` in `line`, skipping anything inside `"…"`. */
function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      // A doubled quote is an escaped quote inside a field, not the end of one.
      if (inQuotes && line[index + 1] === '"') index++;
      else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === delimiter) count++;
  }

  return count;
}

/** Whether a string is one of the separators this tool reads. */
export function isCsvDelimiter(value: string): value is CsvDelimiter {
  return (CSV_DELIMITERS as readonly string[]).includes(value);
}

export interface ParsedDelimitedFile {
  /** One name per column, in file order. Always as many as the widest record. */
  columnNames: string[];
  /** The data rows, each padded or trimmed to `columnNames.length`. */
  rows: string[][];
}

/**
 * Splits delimited text into named columns and rows.
 *
 * A generalisation of `parseCsv` in `@/lib/shared/csv`: same quote handling and
 * same record-aware newline handling, but for any of the four separators, and
 * with two differences that matter for a *browser* rather than an importer.
 *
 * First, **short and long rows are kept**, padded or truncated to the column
 * count. The shared parser drops a row with fewer than half the headers' fields
 * because a half-empty row in a broker export is junk. Here the file is the
 * thing being inspected, so silently dropping its malformed rows would hide
 * exactly what someone opened the tool to find.
 *
 * Second, **the header row is optional** — a `.txt` dump often has none, and
 * consuming its first line of real data as column names would lose a row.
 */
export function parseDelimited(
  text: string,
  delimiter: CsvDelimiter,
  hasHeaderRow: boolean,
): ParsedDelimitedFile {
  const records = splitRecords(text, delimiter).filter((fields) =>
    fields.some((cell) => cell.trim().length > 0),
  );

  if (records.length === 0) return { columnNames: [], rows: [] };

  const [first, ...rest] = records;
  const dataRecords = hasHeaderRow ? rest : records;

  // Sized to the widest record, not to the header: a file whose rows carry more
  // fields than its header row is malformed, and truncating to the header would
  // hide the extra data rather than show it.
  const width = Math.max(first.length, ...dataRecords.map((record) => record.length), 1);

  const columnNames = hasHeaderRow
    ? uniqueColumnNames(first, width)
    : Array.from({ length: width }, (_unused, index) => `Column ${index + 1}`);

  const rows = dataRecords.map((record) =>
    Array.from({ length: width }, (_unused, index) => record[index] ?? ""),
  );

  return { columnNames, rows };
}

/**
 * Header names, made non-empty and distinct.
 *
 * Both are required rather than cosmetic: these become SQLite column names in
 * the sidecar table, where a blank name is not expressible and a duplicate is a
 * create-table error. A real file has both — a trailing separator gives an
 * unnamed last column, and two columns called `Total` is ordinary in an export.
 */
function uniqueColumnNames(headerRecord: string[], width: number): string[] {
  const seen = new Map<string, number>();

  return Array.from({ length: width }, (_unused, index) => {
    const raw = (headerRecord[index] ?? "").trim();
    const base = raw.length > 0 ? raw : `Column ${index + 1}`;

    const previous = seen.get(base);
    if (previous === undefined) {
      seen.set(base, 1);
      return base;
    }

    // `Total`, `Total (2)`, `Total (3)` — the suffix is checked against the set
    // too, since a file can genuinely already contain `Total (2)`.
    let suffix = previous + 1;
    let candidate = `${base} (${suffix})`;
    while (seen.has(candidate)) {
      suffix++;
      candidate = `${base} (${suffix})`;
    }
    seen.set(base, suffix);
    seen.set(candidate, 1);
    return candidate;
  });
}

/**
 * Record-aware split for an arbitrary delimiter.
 *
 * Mirrors `parseCsvRecords`, which is hardcoded to a comma. Newlines inside a
 * quoted field stay part of that field, CRs are normalised away so CRLF and LF
 * files parse identically, and fields are trimmed.
 */
function splitRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let seenContent = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "\r") continue;

    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      seenContent = true;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      seenContent = true;
    } else if (char === delimiter) {
      record.push(field.trim());
      field = "";
      seenContent = true;
    } else if (char === "\n") {
      record.push(field.trim());
      records.push(record);
      field = "";
      record = [];
      seenContent = false;
    } else {
      field += char;
      seenContent = true;
    }
  }

  if (seenContent || field.length > 0 || record.length > 0) {
    record.push(field.trim());
    records.push(record);
  }

  return records;
}

/**
 * Serialises rows back to delimited text, for the export route.
 *
 * A cell is quoted only when it has to be — it holds the delimiter, a quote, or
 * a newline — so a file that needed no quoting on the way in comes back out
 * looking like the one that was uploaded. Embedded quotes are doubled, which is
 * the escape `splitRecords` reads.
 *
 * Rows are joined with `\r\n`: that is what RFC 4180 specifies and what Excel
 * expects, and the parser normalises it away again on a round trip.
 */
export function toDelimitedText(
  columnNames: string[],
  rows: (string | number | null)[][],
  delimiter: CsvDelimiter,
): string {
  return [columnNames, ...rows]
    .map((record) => toDelimitedLine(record, delimiter))
    .join("\r\n");
}

/**
 * One record as a delimited line, with no trailing newline.
 *
 * Exported because the export route streams row by row and must not build the
 * whole file to serialise it. `toDelimitedText` is the convenience wrapper for
 * callers holding everything already — a test, or a small file.
 */
export function toDelimitedLine(
  cells: (string | number | null)[],
  delimiter: CsvDelimiter,
): string {
  return cells.map((cell) => quoteCell(cell, delimiter)).join(delimiter);
}

/** One cell, quoted if it would otherwise break the record structure. */
function quoteCell(value: string | number | null, delimiter: string): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!text.includes(delimiter) && !text.includes('"') && !text.includes("\n") && !text.includes("\r")) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}
