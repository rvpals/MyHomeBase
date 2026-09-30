// Recipe-specific CSV import: turns a mapped CSV record into a createRecipe call.
// The generic mapping machinery (parsing, applyMapping, delimiters, date formats)
// lives in @/lib/csv-import; this adapter knows what each recipe field means.
//
// Modelled on src/lib/journal/csv-import.ts, deliberately — the two share the
// plan/walk/import shape, the skipDuplicates + overwrite pair, and the saved
// mappings table. What differs is only the match key (a recipe has no date, so
// it matches on NAME) and the field list.
import { applyMapping, parseCsvRecords, splitDelimited, summarizeImportResults } from "@/lib/csv-import";
import type {
  ColumnMapping,
  FieldOptions,
  FieldOptionsMap,
  ImportRowResult,
  ImportSummary,
} from "@/lib/csv-import";
import { createRecipe, updateRecipe } from "./household";
import type { HouseholdRepository } from "./ports";
import type { CreateRecipeInput } from "./schema";

/**
 * The recipe fields a CSV column can be mapped to, for the mapping UI.
 *
 * Picture is absent and always will be: a CSV cell cannot carry 2 MB of JPEG,
 * and the recipe's photograph is attached by hand afterwards in the viewer.
 */
export const RECIPE_IMPORT_FIELDS = [
  { value: "name", label: "Name" },
  { value: "description", label: "Description" },
  { value: "ingredients", label: "Ingredients" },
  { value: "directions", label: "Directions" },
  { value: "notes", label: "Notes" },
  { value: "madeCount", label: "Made count" },
  { value: "rating", label: "Rating (1-10)" },
  { value: "category", label: "Category" },
  { value: "sourceUrl", label: "Source URL" },
  { value: "tags", label: "Tags" },
] as const;

const DEFAULT_TAG_DELIMITER = ",";

/**
 * The newline escape a one-line CSV cell uses to mean "next line".
 *
 * A quoted CSV cell CAN hold a real newline, and `parseCsvRecords` handles that
 * — but plenty of exports (and every hand-written sheet) write `\n` literally
 * instead. Both are accepted: the literal two characters are turned into a real
 * newline before the block is stored.
 */
const ESCAPED_NEWLINE = /\\n/g;

/**
 * Fields whose cell holds several values, so they need a delimiter to be split.
 *
 * Ingredients and directions are here alongside tags because they are stored as
 * one-item-per-line blocks: an export that separates them with `;` needs to say
 * so, or the whole list lands as a single unreadable line. Exported so the
 * mapping UI offers the delimiter control on exactly these fields rather than
 * keeping its own list that can drift from this one.
 */
export const RECIPE_LIST_FIELDS = ["ingredients", "directions", "tags"] as const;

/**
 * The options a freshly-mapped column should start with, per target field.
 *
 * The mapping UI must *write* these into its field options rather than merely
 * displaying them as a fallback: a `<select>`'s rendered value fires no change
 * event, so a default that lives only in the control is invisible to the import
 * and the reader is shown a delimiter that was never actually chosen. That is
 * how a space-separated Tags column silently imported as one long tag in
 * Journal, and the same trap is live here.
 *
 * Tags default to comma. Ingredients and directions default to the newline
 * escape, because a multi-line block in a single-line CSV cell is the common
 * case — and because splitting a method on commas would shred every step.
 */
export function defaultRecipeFieldOptions(field: string): FieldOptions | undefined {
  switch (field) {
    case "tags":
      return { delimiter: DEFAULT_TAG_DELIMITER };
    case "ingredients":
    case "directions":
      return { delimiter: "\\n" };
    default:
      return undefined;
  }
}

// Header (lower-cased) -> recipe field. Headers not listed here are left
// unmapped for the user to map manually. The plural/singular pairs are both
// listed rather than stemmed: a lookup table that can be read at a glance beats
// a clever matcher nobody can predict.
const RECIPE_HEADER_RULES: Record<string, { field: string; options?: FieldOptions }> = {
  name: { field: "name" },
  title: { field: "name" },
  recipe: { field: "name" },
  "recipe name": { field: "name" },
  description: { field: "description" },
  summary: { field: "description" },
  ingredient: { field: "ingredients" },
  ingredients: { field: "ingredients" },
  direction: { field: "directions" },
  directions: { field: "directions" },
  instructions: { field: "directions" },
  method: { field: "directions" },
  steps: { field: "directions" },
  note: { field: "notes" },
  notes: { field: "notes" },
  "made count": { field: "madeCount" },
  made: { field: "madeCount" },
  times: { field: "madeCount" },
  "times made": { field: "madeCount" },
  rating: { field: "rating" },
  score: { field: "rating" },
  category: { field: "category" },
  categories: { field: "category" },
  course: { field: "category" },
  type: { field: "category" },
  "meal type": { field: "category" },
  source: { field: "sourceUrl" },
  "source url": { field: "sourceUrl" },
  url: { field: "sourceUrl" },
  link: { field: "sourceUrl" },
  tag: { field: "tags" },
  tags: { field: "tags" },
};

/**
 * Best-effort auto-mapping for common recipe-export headers: returns the column
 * mapping and per-column options implied by recognized header names. Unknown
 * headers are skipped. Used to seed the CLI and the mapping UI's starting point.
 */
export function autoMapRecipeHeaders(headers: string[]): {
  columnMapping: ColumnMapping;
  fieldOptions: FieldOptionsMap;
} {
  const columnMapping: ColumnMapping = {};
  const fieldOptions: FieldOptionsMap = {};
  headers.forEach((header, index) => {
    const rule = RECIPE_HEADER_RULES[header.trim().toLowerCase()];
    if (!rule) return;
    columnMapping[String(index)] = rule.field;
    // A header-specific override wins; otherwise the field's own default, so
    // auto-map and a hand-picked field land on the same options.
    const options = rule.options ?? defaultRecipeFieldOptions(rule.field);
    if (options) fieldOptions[String(index)] = options;
  });
  return { columnMapping, fieldOptions };
}

/**
 * Turns one cell into a stored one-item-per-line block.
 *
 * A real newline ALWAYS separates items, whatever the chosen delimiter — a
 * quoted CSV cell can hold real line breaks, and an export that uses both those
 * and a `;` would otherwise leave the newlines buried inside a "line". So the
 * cell is split on newlines first (real ones, and the literal `\n` escape a
 * flattened export writes instead), and each piece is then split on the
 * delimiter.
 *
 * Splitting here rather than handing the newline to `splitDelimited` is
 * deliberate: that helper takes ONE separator, so a cell would have to choose
 * between them.
 */
function toBlock(value: string, delimiter: string | undefined): string {
  const lines = value.replace(ESCAPED_NEWLINE, "\n").split("\n");

  // The escape and a real newline both mean "next line", so as a delimiter they
  // ask for nothing beyond the split already done above.
  const splitsFurther = delimiter !== undefined && delimiter !== "\\n" && delimiter !== "\n";

  return lines
    .flatMap((line) => (splitsFurther ? splitDelimited(line, delimiter) : [line.trim()]))
    .filter((part) => part.length > 0)
    .join("\n");
}

/**
 * Builds a createRecipe input from one CSV record.
 *
 * Multiple columns may target the same field; for the blocks and tags their
 * values are concatenated (the schema de-dupes tags), and for the scalars the
 * last non-blank cell wins. Throws if no name resolves — an unnamed recipe is
 * not a recipe, and it is also the match key, so a blank one would make every
 * such row a duplicate of every other.
 */
function recordToRecipeInput(
  record: string[],
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
): CreateRecipeInput {
  let name = "";
  let description = "";
  let notes = "";
  let sourceUrl = "";
  let category = "";
  let madeCount = 0;
  // `""` rather than null: the schema maps a blank to "unrated", which is what
  // a missing or empty Rating cell means.
  let rating: string | number = "";
  const ingredients: string[] = [];
  const directions: string[] = [];
  const tags: string[] = [];

  for (const cell of applyMapping(record, columnMapping, fieldOptions)) {
    const value = cell.rawValue.trim();
    switch (cell.field) {
      case "name":
        if (value !== "") name = value;
        break;
      case "description":
        if (value !== "") description = value.replace(ESCAPED_NEWLINE, "\n");
        break;
      case "notes":
        if (value !== "") notes = value.replace(ESCAPED_NEWLINE, "\n");
        break;
      case "sourceUrl":
        if (value !== "") sourceUrl = value;
        break;
      case "category":
        // Stored as the sheet spelled it. Unlike tags, this is not lower-cased
        // and not split on a delimiter — a recipe has ONE category, so a cell
        // reading "Dinner, Quick" is one oddly-named category rather than two,
        // and silently splitting it would invent a value nobody typed.
        if (value !== "") category = value;
        break;
      case "madeCount": {
        // A non-numeric cell is left at 0 rather than failing the row: a made
        // count is an incidental detail, and losing a whole recipe over it
        // would be the wrong trade.
        const parsed = Number(value);
        if (value !== "" && Number.isFinite(parsed)) madeCount = Math.max(0, Math.trunc(parsed));
        break;
      }
      case "rating":
        // Passed through as typed. The schema rejects anything that is not a
        // whole 1-10 or blank, and that error names the row in the summary.
        if (value !== "") rating = value;
        break;
      case "ingredients": {
        const block = toBlock(value, cell.options.delimiter);
        if (block !== "") ingredients.push(block);
        break;
      }
      case "directions": {
        const block = toBlock(value, cell.options.delimiter);
        if (block !== "") directions.push(block);
        break;
      }
      case "tags":
        // Routed through `toBlock` for the same reason the blocks are: a tags
        // cell may use real newlines, the `\n` escape, or a delimiter, and all
        // three mean "next tag". The block's lines are the tags.
        tags.push(
          ...toBlock(value, cell.options.delimiter ?? DEFAULT_TAG_DELIMITER)
            .split("\n")
            .filter((tag) => tag !== ""),
        );
        break;
      default:
        break; // unknown field name — ignore
    }
  }

  if (name === "") throw new Error("no Name column mapped, or its cell was empty");

  return {
    name,
    description,
    ingredients: ingredients.join("\n"),
    directions: directions.join("\n"),
    notes,
    madeCount,
    rating,
    category,
    sourceUrl,
    tags,
  };
}

/** How a CSV row will be resolved against what is already stored. */
export type RecipeImportAction = "create" | "update" | "skip";

/** One row's resolution, as shown in the overwrite confirmation dialog. */
export interface RecipeImportPlanRow {
  /** 1-based row number in the file, counting the header as row 1. */
  rowNumber: number;
  action: RecipeImportAction;
  /** The recipe this row will overwrite. Set only when `action` is "update". */
  recipeId?: number;
  /** The match key, for display. Empty when the row failed to parse. */
  name: string;
  /**
   * Why this row will be skipped — a parse failure, or an existing recipe left
   * alone. Set only when `action` is "skip".
   */
  blockedReason?: string;
}

export interface RecipeImportPlan {
  rows: RecipeImportPlanRow[];
  createCount: number;
  updateCount: number;
  skipCount: number;
}

export interface RecipeImportOptions {
  /**
   * Rows the reader unticked, as 0-based indexes into the file's DATA rows
   * (the header is not one of them). Dropped entirely rather than reported as
   * skips: a skip is something that surprised the importer, and a row the
   * reader deliberately removed is not. Same convention as the Investments
   * importer's `excludedRowIndexes`.
   */
  excludedRowIndexes?: readonly number[];
  /**
   * Skip a row whose name already exists. Default true, so re-importing the
   * same file is a no-op. Ignored when `overwrite` is on.
   */
  skipDuplicates?: boolean;
  /**
   * Update the matched recipe in place instead of skipping it. Takes precedence
   * over `skipDuplicates` — the two would otherwise disagree about what to do
   * with a duplicate, and "overwrite the database from the file" is the more
   * specific instruction.
   *
   * Replaces the whole recipe: a blank CSV cell clears the stored field. Merge
   * semantics would need a per-field rule for what "blank" means, and the
   * toggle does not promise that. The PICTURE survives, because it is not a
   * column `updateRecipe` writes — which is what makes "import the sheet again,
   * keep the photos" work.
   */
  overwrite?: boolean;
}

/**
 * Walks the file once and decides what each row would do, without writing
 * anything. `planRecipeImport` and `importRecipesCsv` both drive this, so the
 * list shown in the confirmation dialog cannot drift from what the import then
 * does.
 *
 * `onRow` is called in file order with the decision and, for a create or an
 * update, the parsed input to write.
 */
function walkRecipeCsv(
  repo: HouseholdRepository,
  fileText: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap,
  options: RecipeImportOptions,
  onRow: (row: RecipeImportPlanRow, input?: CreateRecipeInput) => void,
): void {
  const overwrite = options.overwrite ?? false;
  const skipDuplicates = options.skipDuplicates ?? true;
  const excluded = new Set(options.excludedRowIndexes ?? []);
  const dataRecords = parseCsvRecords(fileText).slice(1); // drop the header row

  // How many copies of each name this file has produced so far, and the ids the
  // table held BEFORE the import began. The stored ids are read once per
  // distinct name and then reused: rows this run inserts must not inflate the
  // baseline, or the second legitimate identical row in one file would look
  // like a duplicate of the first. Same reasoning as the journal importer.
  const seenByName = new Map<string, number>();
  const storedIdsByName = new Map<string, number[]>();

  dataRecords.forEach((record, index) => {
    const rowNumber = index + 2; // 1-based, +1 for the header row
    // Unticked: gone, not skipped. Checked before the blank-row test so the
    // index the reader ticked always lines up with the row they saw.
    if (excluded.has(index)) return;
    if (record.every((cell) => cell.trim() === "")) return;

    let input: CreateRecipeInput;
    try {
      input = recordToRecipeInput(record, columnMapping, fieldOptions);
    } catch (error) {
      onRow({
        rowNumber,
        action: "skip",
        name: "",
        blockedReason: error instanceof Error ? error.message : "unknown error",
      });
      return;
    }

    const name = input.name;
    const base = { rowNumber, name };

    // Neither toggle is on: the file is taken at face value, every row inserts.
    if (!overwrite && !skipDuplicates) {
      onRow({ ...base, action: "create" }, input);
      return;
    }

    // Lower-cased, because the repository matches case-insensitively: "Roast
    // Chicken" and "roast chicken" are one recipe, so they must also share one
    // cache entry or the second would re-read the same ids under a new key.
    const cacheKey = name.toLowerCase();
    let storedIds = storedIdsByName.get(cacheKey);
    if (storedIds === undefined) {
      storedIds = repo.findRecipeIdsByName(name);
      storedIdsByName.set(cacheKey, storedIds);
    }
    const seen = seenByName.get(cacheKey) ?? 0;
    seenByName.set(cacheKey, seen + 1);

    // Beyond the stored count this row is a genuine addition, not a duplicate.
    if (seen >= storedIds.length) {
      onRow({ ...base, action: "create" }, input);
      return;
    }

    if (!overwrite) {
      onRow({ ...base, action: "skip", blockedReason: "A recipe with this name already exists" });
      return;
    }

    // The Nth copy in the file overwrites the Nth stored copy — ordered by id,
    // so a name with several recipes resolves deterministically.
    onRow({ ...base, action: "update", recipeId: storedIds[seen] }, input);
  });
}

/**
 * Works out what an import would do, without writing anything.
 *
 * Drives the overwrite confirmation dialog: the reader sees exactly which stored
 * recipes are about to be replaced, and can cancel. The decision logic is shared
 * with `importRecipesCsv`, so the preview and the write agree.
 *
 * Nothing locks the table between the two calls. In a single-user app the window
 * is however long the dialog stays open; a row that changed in between is
 * re-resolved on the real run rather than blindly applied.
 */
export function planRecipeImport(
  repo: HouseholdRepository,
  fileText: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap = {},
  options: RecipeImportOptions = {},
): RecipeImportPlan {
  const rows: RecipeImportPlanRow[] = [];
  walkRecipeCsv(repo, fileText, columnMapping, fieldOptions, options, (row) => {
    rows.push(row);
  });

  return {
    rows,
    createCount: rows.filter((row) => row.action === "create").length,
    updateCount: rows.filter((row) => row.action === "update").length,
    skipCount: rows.filter((row) => row.action === "skip").length,
  };
}

/** One parsed field, as the Test dialog lists it. */
export interface RecipeTestField {
  label: string;
  rawValue: string;
  value: string;
}

/** One selected row, parsed but not written. */
export interface RecipeTestRow {
  rowNumber: number;
  label: string;
  fields: RecipeTestField[];
  error?: string;
}

/** Field name -> the label the mapping dropdown shows, for the Test dialog. */
const FIELD_LABELS = new Map(RECIPE_IMPORT_FIELDS.map((field) => [field.value, field.label]));

/**
 * Parses the selected rows and reports what WOULD be stored, writing nothing.
 *
 * This exists because a mis-set "split on" is otherwise invisible until the
 * data is already in: an ingredients block that failed to split looks identical
 * in the mapping table (one truncated cell) whether it is one line or twenty.
 * Here it renders with its real line breaks, so the reader can see it.
 *
 * Deliberately built on the same `recordToRecipeInput` the import uses — a
 * second parser written for the preview would be free to disagree with the one
 * that actually writes, which would make this dialog worse than useless.
 */
export function testRecipeImport(
  fileText: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap = {},
  excludedRowIndexes: readonly number[] = [],
): RecipeTestRow[] {
  const excluded = new Set(excludedRowIndexes);
  const dataRecords = parseCsvRecords(fileText).slice(1);
  const rows: RecipeTestRow[] = [];

  dataRecords.forEach((record, index) => {
    if (excluded.has(index)) return;
    if (record.every((cell) => cell.trim() === "")) return;

    const rowNumber = index + 2;

    // The raw cell behind each mapped field, so the dialog can show what the
    // parse started from. Several columns may feed one field; they are joined
    // the way the importer concatenates them.
    const rawByField = new Map<string, string[]>();
    for (const cell of applyMapping(record, columnMapping, fieldOptions)) {
      const existing = rawByField.get(cell.field) ?? [];
      existing.push(cell.rawValue.trim());
      rawByField.set(cell.field, existing);
    }

    let input: CreateRecipeInput;
    try {
      input = recordToRecipeInput(record, columnMapping, fieldOptions);
    } catch (error) {
      rows.push({
        rowNumber,
        label: "",
        fields: [],
        error: error instanceof Error ? error.message : "unknown error",
      });
      return;
    }

    const valueFor = (field: string): string => {
      switch (field) {
        case "name":
          return input.name;
        case "description":
          return input.description ?? "";
        case "ingredients":
          return input.ingredients ?? "";
        case "directions":
          return input.directions ?? "";
        case "notes":
          return input.notes ?? "";
        case "madeCount":
          return String(input.madeCount ?? 0);
        case "rating":
          return input.rating === null || input.rating === undefined || input.rating === ""
            ? "(unrated)"
            : String(input.rating);
        case "category":
          return input.category === undefined || input.category === ""
            ? "(uncategorised)"
            : input.category;
        case "sourceUrl":
          return input.sourceUrl ?? "";
        case "tags":
          return (input.tags ?? []).join(", ");
        default:
          return "";
      }
    };

    // Listed in the field list's own order, not the CSV's: the reader is
    // checking the RECIPE came out right, not re-reading their spreadsheet.
    const fields: RecipeTestField[] = RECIPE_IMPORT_FIELDS.filter((field) =>
      rawByField.has(field.value),
    ).map((field) => ({
      label: FIELD_LABELS.get(field.value) ?? field.value,
      rawValue: (rawByField.get(field.value) ?? []).join(" | "),
      value: valueFor(field.value),
    }));

    rows.push({ rowNumber, label: input.name, fields });
  });

  return rows;
}

/**
 * Imports recipes from CSV text using a column mapping and per-column options.
 * Best-effort: every parseable row is imported; each failing row is recorded
 * (never silently dropped) in the returned summary. The first record is treated
 * as the header row and skipped, and fully-blank lines are ignored.
 *
 * **Idempotent by default.** A row whose name already exists is reported as
 * skipped rather than imported, so re-importing the same file is a no-op. Pass
 * `{ skipDuplicates: false }` to import them anyway — the CSV is then taken at
 * face value, which is what you want when a file deliberately holds two
 * different recipes that happen to share a name.
 *
 * Pass `{ overwrite: true }` to update matched recipes in place instead. That is
 * destructive: call `planRecipeImport` first and confirm with the reader.
 *
 * Only the name is matched on. The consequence without `overwrite` is that an
 * edited recipe's new text will NOT overwrite the stored one — the import only
 * declines to duplicate it.
 */
export function importRecipesCsv(
  repo: HouseholdRepository,
  fileText: string,
  columnMapping: ColumnMapping,
  fieldOptions: FieldOptionsMap = {},
  options: RecipeImportOptions = {},
): ImportSummary {
  const results: ImportRowResult[] = [];

  walkRecipeCsv(repo, fileText, columnMapping, fieldOptions, options, (row, input) => {
    if (row.action === "skip" || !input) {
      results.push({ rowNumber: row.rowNumber, status: "skipped", reason: row.blockedReason });
      return;
    }

    try {
      if (row.action === "update" && row.recipeId !== undefined) {
        updateRecipe(repo, row.recipeId, input);
        results.push({ rowNumber: row.rowNumber, status: "updated" });
      } else {
        createRecipe(repo, input);
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
