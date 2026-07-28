// Journal-specific CSV import: turns a mapped CSV record into a createEntry call.
// The generic mapping machinery (parsing, applyMapping, delimiters, date formats)
// lives in @/lib/csv-import; this adapter knows what each journal field means.
import {
  applyMapping,
  parseCsvRecords,
  parseDateWithFormat,
  splitDelimited,
  summarizeImportResults,
} from "@/lib/csv-import";
import type {
  ColumnMapping,
  FieldOptions,
  FieldOptionsMap,
  ImportRowResult,
  ImportSummary,
} from "@/lib/csv-import";
import { createEntry } from "./journal";
import type { JournalRepository } from "./ports";
import type { CreateEntryInput, EntryLocationInput } from "./schema";

// The journal fields a CSV column can be mapped to, for the mapping UI. People
// is intentionally absent as a distinct field — a People column is mapped to
// "tags" (with a comma delimiter), merging into the entry's tags.
export const JOURNAL_IMPORT_FIELDS = [
  { value: "date", label: "Date" },
  { value: "time", label: "Time" },
  { value: "title", label: "Title" },
  { value: "content", label: "Content" },
  { value: "placeName", label: "Place name" },
  { value: "categories", label: "Categories" },
  { value: "tags", label: "Tags" },
  { value: "locations", label: "Locations (lat,lng pairs)" },
] as const;

const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
const DEFAULT_LIST_DELIMITER = ",";

// Header (lower-cased) -> journal field + the options that match this export's
// conventions: dates are M/D/YY, categories comma-separated, tags space-separated,
// and a People column feeds tags (comma-separated names). Headers not listed here
// are left unmapped for the user to map manually.
const JOURNAL_HEADER_RULES: Record<string, { field: string; options?: FieldOptions }> = {
  date: { field: "date", options: { dateFormat: "M/D/YY" } },
  time: { field: "time" },
  category: { field: "categories", options: { delimiter: "," } },
  categories: { field: "categories", options: { delimiter: "," } },
  tags: { field: "tags", options: { delimiter: " " } },
  places: { field: "locations" },
  "place name": { field: "placeName" },
  people: { field: "tags", options: { delimiter: "," } },
  title: { field: "title" },
  content: { field: "content" },
};

/**
 * Best-effort auto-mapping for this journal export's headers: returns the column
 * mapping and per-column options implied by recognized header names. Unknown
 * headers are skipped. Used to seed the CLI and the mapping UI's "auto-map".
 */
export function autoMapJournalHeaders(headers: string[]): {
  columnMapping: ColumnMapping;
  fieldOptions: FieldOptionsMap;
} {
  const columnMapping: ColumnMapping = {};
  const fieldOptions: FieldOptionsMap = {};
  headers.forEach((header, index) => {
    const rule = JOURNAL_HEADER_RULES[header.trim().toLowerCase()];
    if (!rule) return;
    columnMapping[String(index)] = rule.field;
    if (rule.options) fieldOptions[String(index)] = rule.options;
  });
  return { columnMapping, fieldOptions };
}

// Parses "lat,lng, lat,lng, ..." into locations. This column carries no names in
// the export (a single free-text place lives in its own column), so
// locationName is left empty. A trailing unpaired number is ignored.
function parseLocationPairs(value: string): EntryLocationInput[] {
  const numbers = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map(Number);

  const locations: EntryLocationInput[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    const latitude = numbers[i];
    const longitude = numbers[i + 1];
    if (Number.isNaN(latitude) || Number.isNaN(longitude)) continue;
    locations.push({ latitude, longitude });
  }
  return locations;
}

// Builds a createEntry input from one CSV record. Multiple columns may target
// the same field (Tags and People both -> tags); their parsed values are
// concatenated and createEntry de-dupes. Throws if no date resolves — a dated
// entry is the minimum a journal row must carry.
function recordToEntryInput(
  record: string[],
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
): CreateEntryInput {
  let date: string | undefined;
  let time = "";
  let title = "";
  let content = "";
  let placeName = "";
  const categories: string[] = [];
  const tags: string[] = [];
  const locations: EntryLocationInput[] = [];

  for (const cell of applyMapping(record, columnMapping, fieldOptions)) {
    const value = cell.rawValue.trim();
    switch (cell.field) {
      case "date":
        if (value !== "") {
          date = parseDateWithFormat(value, cell.options.dateFormat ?? DEFAULT_DATE_FORMAT);
        }
        break;
      case "time":
        time = value;
        break;
      case "title":
        title = value;
        break;
      case "content":
        content = value;
        break;
      case "placeName":
        placeName = value;
        break;
      case "categories":
        categories.push(...splitDelimited(value, cell.options.delimiter ?? DEFAULT_LIST_DELIMITER));
        break;
      case "tags":
        tags.push(...splitDelimited(value, cell.options.delimiter ?? DEFAULT_LIST_DELIMITER));
        break;
      case "locations":
        locations.push(...parseLocationPairs(value));
        break;
      default:
        break; // unknown field name — ignore
    }
  }

  if (!date) throw new Error("no Date column mapped, or its cell was empty");

  return { date, time, title, content, placeName, categories, tags, locations };
}

/**
 * Imports journal entries from CSV text using a column mapping and per-column
 * options. Best-effort: every parseable row is imported; each failing row is
 * recorded (never silently dropped) in the returned summary. The first record is
 * treated as the header row and skipped, and fully-blank lines are ignored.
 */
export function importJournalCsv(
  repo: JournalRepository,
  fileText: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap = {},
): ImportSummary {
  const dataRecords = parseCsvRecords(fileText).slice(1); // drop the header row
  const results: ImportRowResult[] = [];

  dataRecords.forEach((record, index) => {
    const rowNumber = index + 2; // 1-based, +1 for the header row
    if (record.every((cell) => cell.trim() === "")) return;

    try {
      createEntry(repo, recordToEntryInput(record, columnMapping, fieldOptions));
      results.push({ rowNumber, status: "imported" });
    } catch (error) {
      results.push({
        rowNumber,
        status: "skipped",
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }
  });

  return summarizeImportResults(results);
}
