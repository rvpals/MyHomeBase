// Pure — no I/O. Generic CSV parsing shared by any domain that reads a CSV file
// (csv-import's broker-specific mapping, csv-analytics' user-defined tables, etc).

/** Quote-aware split of one CSV line (handles embedded commas and "" escaped quotes). */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/**
 * Record-aware CSV tokenizer: splits the whole text into records, correctly
 * keeping newlines that appear *inside* a quoted field as part of that field.
 * This is what `parseCsvLine` (which works one physical line at a time) cannot
 * do, and it's required for exports whose cells hold multi-line prose. CRs are
 * normalized away so CRLF and LF files parse identically. Fields are trimmed,
 * matching `parseCsvLine`.
 */
export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let seenContent = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\r") continue; // normalize CRLF/CR to LF

    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char; // includes newlines inside a quoted field
      }
      seenContent = true;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      seenContent = true;
    } else if (char === ",") {
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

  // Flush a trailing record that wasn't terminated by a newline.
  if (seenContent || field.length > 0 || record.length > 0) {
    record.push(field.trim());
    records.push(record);
  }

  return records;
}

/** Splits CSV text into headers + data rows, dropping blank lines and rows too short to be real data. */
export function parseCsv(text: string): ParsedCsv {
  const records = parseCsvRecords(text).filter((fields) =>
    fields.some((cell) => cell.trim().length > 0),
  );
  if (records.length === 0) return { headers: [], rows: [] };

  const headers = records[0];
  const rows = records.slice(1).filter((fields) => fields.length >= headers.length / 2);
  return { headers, rows };
}
