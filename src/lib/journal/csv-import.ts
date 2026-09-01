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
import { createEntry, updateEntry } from "./journal";
import type { JournalEntryMatchKey, JournalRepository } from "./ports";
import type { CreateEntryInput, EntryLocationInput } from "./schema";
import { normalizeEntryTime } from "./time";

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
        // Normalized here, not just by createEntrySchema on write: matchKeyFor
        // reads this object, so a raw "15:30:00" would be compared against a
        // stored canonical "15:30" and the row would look new.
        time = normalizeEntryTime(value);
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

/** The key that decides whether a row is a duplicate: date + time + title. */
function matchKeyFor(input: CreateEntryInput): JournalEntryMatchKey {
  return { date: input.date, time: input.time ?? "", title: (input.title ?? "").trim() };
}

/** How a CSV row will be resolved against what is already stored. */
export type JournalImportAction = "create" | "update" | "skip";

/** One row's resolution, as shown in the overwrite confirmation dialog. */
export interface JournalImportPlanRow {
  /** 1-based row number in the file, counting the header as row 1. */
  rowNumber: number;
  action: JournalImportAction;
  /** The entry this row will overwrite. Set only when `action` is "update". */
  entryId?: number;
  /** The match key, for display. Empty strings when the row failed to parse. */
  date: string;
  time: string;
  title: string;
  /**
   * Why this row will be skipped — a parse failure, an existing entry left
   * alone, or a locked entry that overwrite is not allowed to touch. Set only
   * when `action` is "skip".
   */
  blockedReason?: string;
}

export interface JournalImportPlan {
  rows: JournalImportPlanRow[];
  createCount: number;
  updateCount: number;
  skipCount: number;
}

export interface JournalImportOptions {
  /**
   * Skip a row whose date, time and title already exist. Default true, so
   * re-importing the same export is a no-op. Ignored when `overwrite` is on.
   */
  skipDuplicates?: boolean;
  /**
   * Update the matched entry in place instead of skipping it. Takes precedence
   * over `skipDuplicates` — the two would otherwise disagree about what to do
   * with a duplicate, and "overwrite the database from the file" is the more
   * specific instruction.
   *
   * Replaces the whole entry: a blank CSV cell clears the stored field. Merge
   * semantics would need a per-field rule for what "blank" means, and the
   * toggle does not promise that.
   */
  overwrite?: boolean;
}

// Walks the file once and decides what each row would do, without writing
// anything. `planJournalImport` and `importJournalCsv` both drive this, so the
// list shown in the confirmation dialog cannot drift from what the import then
// does.
//
// `onRow` is called in file order with the decision and, for a create or an
// update, the parsed input to write.
function walkJournalCsv(
  repo: JournalRepository,
  fileText: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
  options: JournalImportOptions,
  onRow: (row: JournalImportPlanRow, input?: CreateEntryInput) => void,
): void {
  const overwrite = options.overwrite ?? false;
  const skipDuplicates = options.skipDuplicates ?? true;
  const dataRecords = parseCsvRecords(fileText).slice(1); // drop the header row

  // How many copies of each key this file has produced so far, and the ids the
  // table held BEFORE the import began. The stored ids are read once per
  // distinct key and then reused: rows this run inserts must not inflate the
  // baseline, or the second legitimate identical row in one file would look
  // like a duplicate of the first. Same reasoning as importTransactionsFromCsv.
  const seenByKey = new Map<string, number>();
  const storedIdsByKey = new Map<string, number[]>();

  dataRecords.forEach((record, index) => {
    const rowNumber = index + 2; // 1-based, +1 for the header row
    if (record.every((cell) => cell.trim() === "")) return;

    let input: CreateEntryInput;
    try {
      input = recordToEntryInput(record, columnMapping, fieldOptions);
    } catch (error) {
      onRow({
        rowNumber,
        action: "skip",
        date: "",
        time: "",
        title: "",
        blockedReason: error instanceof Error ? error.message : "unknown error",
      });
      return;
    }

    const key = matchKeyFor(input);
    const base = { rowNumber, date: key.date, time: key.time, title: key.title };

    // Neither toggle is on: the file is taken at face value, every row inserts.
    if (!overwrite && !skipDuplicates) {
      onRow({ ...base, action: "create" }, input);
      return;
    }

    // Tab-joined: a literal tab can't appear in a CSV cell that parsed as one
    // field, so no two distinct keys can collide on this string.
    const cacheKey = [key.date, key.time, key.title].join("\t");
    let storedIds = storedIdsByKey.get(cacheKey);
    if (storedIds === undefined) {
      storedIds = repo.findEntryIdsMatching(key);
      storedIdsByKey.set(cacheKey, storedIds);
    }
    const seen = seenByKey.get(cacheKey) ?? 0;
    seenByKey.set(cacheKey, seen + 1);

    // Beyond the stored count this row is a genuine addition, not a duplicate.
    if (seen >= storedIds.length) {
      onRow({ ...base, action: "create" }, input);
      return;
    }

    if (!overwrite) {
      onRow({ ...base, action: "skip", blockedReason: "Duplicate of an existing entry" });
      return;
    }

    // The Nth copy in the file overwrites the Nth stored copy — ordered by id,
    // so a key with several entries resolves deterministically.
    const entryId = storedIds[seen];
    const existing = repo.getEntryById(entryId);
    if (existing?.isLocked) {
      // Surfaced in the plan rather than thrown at write time, so a locked
      // entry is visible in the confirmation dialog before anything is written.
      onRow({ ...base, action: "skip", blockedReason: "Locked — unlock it before overwriting" });
      return;
    }

    onRow({ ...base, action: "update", entryId }, input);
  });
}

/**
 * Works out what an import would do, without writing anything.
 *
 * Drives the overwrite confirmation dialog: the reader sees exactly which stored
 * entries are about to be replaced, and can cancel. The decision logic is shared
 * with `importJournalCsv`, so the preview and the write agree.
 *
 * Nothing locks the table between the two calls. In a single-user app the window
 * is however long the dialog stays open; a row that changed in between is
 * re-resolved on the real run rather than blindly applied.
 */
export function planJournalImport(
  repo: JournalRepository,
  fileText: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap = {},
  options: JournalImportOptions = {},
): JournalImportPlan {
  const rows: JournalImportPlanRow[] = [];
  walkJournalCsv(repo, fileText, columnMapping, fieldOptions, options, (row) => {
    rows.push(row);
  });

  return {
    rows,
    createCount: rows.filter((row) => row.action === "create").length,
    updateCount: rows.filter((row) => row.action === "update").length,
    skipCount: rows.filter((row) => row.action === "skip").length,
  };
}

/**
 * Imports journal entries from CSV text using a column mapping and per-column
 * options. Best-effort: every parseable row is imported; each failing row is
 * recorded (never silently dropped) in the returned summary. The first record is
 * treated as the header row and skipped, and fully-blank lines are ignored.
 *
 * **Idempotent by default.** A row whose date, time and title already exist is
 * reported as skipped rather than imported, so re-importing the same export is a
 * no-op. Pass `{ skipDuplicates: false }` to import them anyway — the CSV is
 * then taken at face value, which is what you want when a file deliberately
 * holds a second copy of something.
 *
 * Pass `{ overwrite: true }` to update matched entries in place instead. That is
 * the answer to the limitation below, and it is destructive: call
 * `planJournalImport` first and confirm with the reader.
 *
 * Content is not part of the match: a re-export with reflowed body text is the
 * same entry. Without `overwrite` the consequence is that an edited entry's new
 * text will NOT overwrite the stored one — the import only declines to
 * duplicate it.
 */
export function importJournalCsv(
  repo: JournalRepository,
  fileText: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap = {},
  options: JournalImportOptions = {},
): ImportSummary {
  const results: ImportRowResult[] = [];

  walkJournalCsv(repo, fileText, columnMapping, fieldOptions, options, (row, input) => {
    if (row.action === "skip" || !input) {
      results.push({ rowNumber: row.rowNumber, status: "skipped", reason: row.blockedReason });
      return;
    }

    try {
      if (row.action === "update" && row.entryId !== undefined) {
        updateEntry(repo, row.entryId, input);
        results.push({ rowNumber: row.rowNumber, status: "updated" });
      } else {
        createEntry(repo, input);
        results.push({ rowNumber: row.rowNumber, status: "imported" });
      }
    } catch (error) {
      results.push({
        rowNumber: row.rowNumber,
        status: "skipped",
        reason: error instanceof Error ? error.message : "unknown error",
      });
    }
  });

  return summarizeImportResults(results);
}
