// Pooling several same-shaped CSV files into ONE dataset, with each row remembering
// which file it came from.
//
// Pure — no I/O, no better-sqlite3. Everything here is "text in, plan or rows out", so
// the whole policy (what counts as the same shape, what a file is called, what a row
// gets tagged with) is unit-testable without a database or a browser.
//
// ## Why source columns are real columns
//
// A pooled row's origin is stored as ordinary columns on the entry's own table rather
// than in a side table. That is the decision this file exists to serve: custom views,
// charts, bulk edit and grid export all already work on the entry's columns, so making
// the source one of them means every one of those features works on it for free. A join
// table would have meant reworking view-query.ts and the repository's read path.
//
// ## Why headers must match exactly
//
// These files are declared by the reader to be the same kind of data from several
// devices — all humidity meters, say. So a differing header is a *wrong file*, not a
// schema to merge, and `planMultiFileImport` refuses rather than silently importing a
// column of NULLs. The mismatch is reported per file so the screen can show which one.

import { parseCsv } from "@/lib/shared/csv";
import { dedupeColumnNames, inferColumnType, slugifyIdentifier } from "./sql-builder";
import type {
  CsvColumnDefinition,
  CsvImportFile,
  CsvSourceColumn,
  MultiFileImportPlan,
} from "./types";

/**
 * The column every pooled dataset carries: which file the row came from.
 *
 * Leading underscore so it can never collide with a column a CSV produced —
 * `slugifyIdentifier` strips leading underscores off any header, so no real header
 * can ever slugify to this. Same trick as `ROWID_ALIAS`.
 */
export const SOURCE_FILE_COLUMN = "_source_file";

/** Up to three reader-typed labels per file ("Room", "Floor", "Device"). */
export const MAX_SOURCE_LABEL_COLUMNS = 3;

/**
 * How many rows to sample when inferring a column's type.
 *
 * The single-file path samples 5 (`PREVIEW_ROW_COUNT`), which is how a column of
 * mostly-fractional humidity readings can infer `integer` off five whole numbers and
 * then coerce every fractional value to NULL. Pooling makes that worse — one file
 * decides the type for all of them — so this path reads far more of the file. Capped
 * rather than unbounded so a very large CSV doesn't pay a full scan for a suggestion.
 */
export const TYPE_SAMPLE_ROW_COUNT = 1000;

/**
 * Strips the extension and any trailing export/timestamp noise off a filename to
 * suggest what that file's source should be called.
 *
 * "Master Bathroom_export_202609221408.csv" -> "Master Bathroom"
 *
 * Only ever a *suggestion* — the import screen shows it in an editable field, because
 * no filename convention survives contact with every device. Falls back to the bare
 * stem, and finally to "Unnamed", so this never returns an empty string.
 */
export function suggestSourceName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]*$/, "").trim();
  if (stem === "") return "Unnamed";

  // Cut at an "_export..." marker, or at a trailing _<8+ digits> timestamp.
  let name = stem.replace(/[_-]export[_-].*$/i, "");
  name = name.replace(/[_-]\d{8,}$/, "");
  name = name.replace(/[_\s-]+$/, "").trim();

  return name === "" ? stem : name;
}

/**
 * Builds the source columns for a pooled dataset: the filename column, then one per
 * reader-supplied label.
 *
 * Label names are slugified and deduped against the data columns *and* each other, so
 * a label called "Temperature_Fahrenheit" can't shadow the real measurement column.
 * Throws on more than `MAX_SOURCE_LABEL_COLUMNS` labels — a caller bug, since the UI
 * caps it.
 */
export function buildSourceColumns(
  dataColumns: CsvColumnDefinition[],
  labels: string[],
): CsvSourceColumn[] {
  if (labels.length > MAX_SOURCE_LABEL_COLUMNS) {
    throw new Error(`At most ${MAX_SOURCE_LABEL_COLUMNS} label columns are supported.`);
  }

  const taken = new Set(dataColumns.map((column) => column.name));
  taken.add(SOURCE_FILE_COLUMN);

  const sourceColumns: CsvSourceColumn[] = [
    { name: SOURCE_FILE_COLUMN, kind: "file", label: "Source file" },
  ];

  labels.forEach((rawLabel) => {
    const trimmed = rawLabel.trim();
    if (trimmed === "") return;

    let name = slugifyIdentifier(trimmed, "label");
    let suffix = 2;
    while (taken.has(name)) {
      name = `${slugifyIdentifier(trimmed, "label")}_${suffix}`;
      suffix += 1;
    }
    taken.add(name);

    sourceColumns.push({ name, kind: "label", label: trimmed });
  });

  return sourceColumns;
}

/** A source column becomes a plain TEXT column on the physical table. */
export function sourceColumnDefinitions(sourceColumns: CsvSourceColumn[]): CsvColumnDefinition[] {
  return sourceColumns.map((column) => ({
    name: column.name,
    sourceHeader: column.label,
    type: "text" as const,
  }));
}

/**
 * Works out what importing these files together would produce, without writing
 * anything.
 *
 * The first file defines the schema; every later file's headers must match it exactly
 * (same count, same order, same text). Any that don't are listed in `headerMismatches`,
 * which the caller must treat as a hard stop — `buildPooledRows` refuses too, so the
 * check can't be skipped by going straight to the rows.
 *
 * Column types are inferred from the first file's sample. That is a deliberate
 * simplification: the files are the same kind of data, so their types agree; if they
 * disagree the reader has dropped a wrong file, which the header check already catches
 * in every case we can detect.
 */
export function planMultiFileImport(
  files: { fileName: string; fileText: string }[],
  labels: string[],
): MultiFileImportPlan {
  if (files.length === 0) throw new Error("Drop at least one CSV file to import.");

  const parsed = files.map((file) => ({ ...file, ...parseCsv(file.fileText) }));
  const [first, ...rest] = parsed;

  if (first.headers.length === 0) {
    throw new Error(`"${first.fileName}" has no columns — it may not be a CSV file.`);
  }

  const sanitizedNames = dedupeColumnNames(first.headers);
  const sample = first.rows.slice(0, TYPE_SAMPLE_ROW_COUNT);
  const dataColumns: CsvColumnDefinition[] = first.headers.map((sourceHeader, index) => ({
    name: sanitizedNames[index],
    sourceHeader,
    type: inferColumnType(sample.map((row) => row[index] ?? "")),
  }));

  const headerMismatches: { fileName: string; reason: string }[] = [];
  rest.forEach((file) => {
    if (file.headers.length !== first.headers.length) {
      headerMismatches.push({
        fileName: file.fileName,
        reason:
          `has ${file.headers.length} column(s), but "${first.fileName}" has ` +
          `${first.headers.length}.`,
      });
      return;
    }
    const differing = file.headers.findIndex((header, index) => header !== first.headers[index]);
    if (differing >= 0) {
      headerMismatches.push({
        fileName: file.fileName,
        reason:
          `column ${differing + 1} is "${file.headers[differing]}", but ` +
          `"${first.fileName}" has "${first.headers[differing]}".`,
      });
    }
  });

  return {
    dataColumns,
    sourceColumns: buildSourceColumns(dataColumns, labels),
    files: parsed.map((file) => ({
      fileName: file.fileName,
      rowCount: file.rows.length,
      suggestedSourceName: suggestSourceName(file.fileName),
    })),
    totalRows: parsed.reduce((total, file) => total + file.rows.length, 0),
    headerMismatches,
  };
}

/**
 * Turns the configured files into the flat `string[][]` the repository inserts —
 * every file's rows concatenated, each widened with its source values.
 *
 * Row shape is `[...dataColumns, ...sourceColumns]`, matching the column order
 * `planMultiFileImport` produced, because the repository's INSERT binds by position
 * against that same list.
 *
 * Re-validates the headers rather than trusting the caller to have checked the plan:
 * this is the function that actually shapes what gets written, so it is the honest
 * place for the guard.
 */
export function buildPooledRows(
  files: CsvImportFile[],
  dataColumns: CsvColumnDefinition[],
  sourceColumns: CsvSourceColumn[],
): string[][] {
  if (files.length === 0) throw new Error("Drop at least one CSV file to import.");

  const expectedHeaders = dataColumns.map((column) => column.sourceHeader);
  const pooled: string[][] = [];

  files.forEach((file) => {
    const { headers, rows } = parseCsv(file.fileText);
    const matches =
      headers.length === expectedHeaders.length &&
      expectedHeaders.every((header, index) => header === headers[index]);
    if (!matches) {
      throw new Error(
        `"${file.fileName}" does not have the same columns as the rest of this import ` +
          `(expected ${expectedHeaders.join(", ")}).`,
      );
    }

    rows.forEach((row) => {
      // Pad first: a short trailing row would otherwise push the source values left
      // into a data column's slot.
      const widened = [...row];
      while (widened.length < dataColumns.length) widened.push("");

      sourceColumns.forEach((column) => {
        widened.push(
          column.kind === "file" ? file.fileName : (file.labelValues[column.name] ?? "").trim(),
        );
      });
      pooled.push(widened);
    });
  });

  return pooled;
}

/**
 * The columns a pooled dataset may be grouped by on the Compare screen.
 *
 * Returns the source columns that still exist on the entry, so a dataset whose label
 * column was dropped degrades to grouping by filename rather than throwing — the same
 * read-time forgiveness a custom view gives a missing column.
 */
export function groupableSourceColumns(
  sourceColumns: CsvSourceColumn[],
  columns: CsvColumnDefinition[],
): CsvSourceColumn[] {
  const present = new Set(columns.map((column) => column.name));
  return sourceColumns.filter((column) => present.has(column.name));
}
