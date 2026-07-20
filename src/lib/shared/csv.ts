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

/** Splits CSV text into headers + data rows, dropping blank lines and rows too short to be real data. */
export function parseCsv(text: string): ParsedCsv {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = parseCsvLine(lines[0]);
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length >= headers.length / 2) rows.push(fields);
  }
  return { headers, rows };
}
