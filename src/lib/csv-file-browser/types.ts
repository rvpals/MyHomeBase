import type { CsvDelimiter } from "./delimiter";

/** One uploaded delimited file, as the module records it. */
export interface UploadedCsvFile {
  id: number;
  /** The name the file had on the reader's machine, shown in the picker. */
  originalFileName: string;
  /**
   * The name the original text was saved under in the upload root. Generated,
   * never the reader's own name: two people uploading `data.csv` must not
   * collide, and a name off a file dialog can carry path separators.
   */
  storedFileName: string;
  /**
   * The name of the SQLite sidecar the rows were loaded into.
   *
   * The sidecar is what every read and write after the upload touches — the
   * original text is kept only so the delimiter and the raw bytes are still
   * recoverable, and it is never rewritten.
   */
  tableFileName: string;
  delimiter: CsvDelimiter;
  hasHeaderRow: boolean;
  /** The column names, in file order. Derived at import and fixed thereafter. */
  columnNames: string[];
  /** Rows at import. Kept current as rows are deleted, so the picker can say. */
  rowCount: number;
  byteSize: number;
  /** Who uploaded it. Null once that account is deleted — the file outlives it. */
  uploadedByUserId: number | null;
  uploadedByName: string | null;
  uploadedAt: string;
}

/**
 * What a cell can hold.
 *
 * Always a string in practice — every column is stored as text, because that
 * is what a delimited file actually contains and inferring otherwise would
 * mean an edit could be silently coerced into something the file never said.
 * `null` is still possible: a row shorter than the header leaves its trailing
 * columns genuinely absent rather than empty.
 */
export type CsvCellValue = string | null;

/** One row of a browsed file, addressed by the sidecar's rowid. */
export interface CsvBrowsedRow {
  rowId: number;
  /** Positionally matching the page's `columns`. */
  cells: CsvCellValue[];
}

/** A capped read of one uploaded file's rows. */
export interface CsvBrowsedPage {
  fileId: number;
  columns: string[];
  rows: CsvBrowsedRow[];
  /** Every row the file holds, so the view can say what it isn't showing. */
  totalRows: number;
  /** How many of them came back. */
  returnedRows: number;
  /** Where this page started, so the view can page forward and back. */
  offset: number;
}

/** The outcome of a delete. */
export interface DeleteCsvRowsResult {
  fileId: number;
  deletedCount: number;
  /** The file's row count after the delete, so the caller needn't re-read. */
  remainingRows: number;
}

/** The outcome of an edit — one row or many. */
export interface EditCsvRowsResult {
  fileId: number;
  updatedCount: number;
  /** The column names that were written, in the file's column order. */
  fields: string[];
}

/**
 * The columns to write and what to write into them.
 *
 * `null` clears a cell. A column absent from the record is left alone, which
 * is what makes a bulk edit able to touch two columns of a forty-column file
 * without disturbing the other thirty-eight.
 */
export type CsvCellChanges = Record<string, string | null>;
