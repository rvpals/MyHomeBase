/** One uploaded SQLite file, as the module records it. */
export interface UploadedDatabase {
  id: number;
  /** The name the file had on the reader's machine, shown in the picker. */
  originalFileName: string;
  /**
   * The name it was saved under in the upload root. Generated, never the
   * reader's own name: two people uploading `data.db` must not collide, and a
   * name off a file dialog can carry path separators.
   */
  storedFileName: string;
  byteSize: number;
  /** Who uploaded it. Null once that account is deleted — the file outlives it. */
  uploadedByUserId: number | null;
  uploadedByName: string | null;
  uploadedAt: string;
}

/** One column of a table inside an uploaded file. */
export interface BrowsedColumn {
  name: string;
  type: string;
  isPrimaryKey: boolean;
}

/** One table inside an uploaded file, as the table picker lists it. */
export interface BrowsedTable {
  name: string;
  rowCount: number;
  columns: BrowsedColumn[];
  /**
   * Whether rows in this table can be addressed by rowid — false for a view or
   * a WITHOUT ROWID table. The view reads this to decide whether the delete
   * controls render at all, rather than offering a button that cannot work.
   */
  canDelete: boolean;
}

/** What a cell can be once it is safe to send to a browser. */
export type BrowsedValue = string | number | null;

/** A capped read of one table's rows. */
export interface BrowsedPage {
  tableName: string;
  columns: string[];
  /**
   * Each row's cells, positionally matching `columns`, plus the rowid that
   * addresses it. The rowid is the delete key: row *position* shifts the moment
   * anything is sorted or filtered, and the grid does both.
   */
  rows: BrowsedRow[];
  /** Every row the table holds, so the view can say what it isn't showing. */
  totalRows: number;
  /** How many of them came back. */
  returnedRows: number;
  canDelete: boolean;
}

/** One row of a browsed table. */
export interface BrowsedRow {
  /** Undefined where the source has no rowid, which is also when `canDelete` is false. */
  rowId: number | undefined;
  cells: BrowsedValue[];
}

/** The outcome of a delete against an uploaded file. */
export interface DeleteRowsResult {
  tableName: string;
  deletedCount: number;
}
