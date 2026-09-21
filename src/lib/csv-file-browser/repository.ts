import type Database from "better-sqlite3";
import { DEFAULT_DELIMITER, isCsvDelimiter } from "./delimiter";
import type { UploadedCsvFileRepository, UploadedCsvFileWriteData } from "./ports";
import type { UploadedCsvFile } from "./types";

interface UploadedCsvFileRow {
  id: number;
  original_file_name: string;
  stored_file_name: string;
  table_file_name: string;
  delimiter: string;
  has_header_row: number;
  column_names: string;
  row_count: number;
  byte_size: number;
  uploaded_by_user_id: number | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
}

// Every read LEFT JOINs `sys_users` for the uploader's display name. LEFT
// rather than INNER: an upload outlives the account that made it, and deleting
// a user must not silently empty the shared list. A missing user reads as
// "Unknown" in the view instead of dropping the row. Same pattern as
// `tol_uploaded_databases`.
const SELECT_FILES = `
  SELECT f.id,
         f.original_file_name,
         f.stored_file_name,
         f.table_file_name,
         f.delimiter,
         f.has_header_row,
         f.column_names,
         f.row_count,
         f.byte_size,
         f.uploaded_by_user_id,
         s.full_name AS uploaded_by_name,
         f.uploaded_at
    FROM tol_uploaded_csv_files f
    LEFT JOIN sys_users s ON s.id = f.uploaded_by_user_id`;

/**
 * The only file in this module that knows SQL against the *app's* database.
 *
 * It stores metadata about uploaded files and nothing else. The rows inside an
 * uploaded file are `csv-table-store.ts`'s job, over a different connection to
 * a different file.
 */
export class SqliteUploadedCsvFileRepository implements UploadedCsvFileRepository {
  constructor(private readonly db: Database.Database) {}

  list(): UploadedCsvFile[] {
    const rows = this.db
      .prepare(`${SELECT_FILES} ORDER BY f.uploaded_at DESC, f.id DESC`)
      .all() as UploadedCsvFileRow[];
    return rows.map(toDomain);
  }

  getById(id: number): UploadedCsvFile | undefined {
    const row = this.db.prepare(`${SELECT_FILES} WHERE f.id = ?`).get(id) as
      | UploadedCsvFileRow
      | undefined;
    return row ? toDomain(row) : undefined;
  }

  create(input: UploadedCsvFileWriteData): UploadedCsvFile {
    const result = this.db
      .prepare(
        `INSERT INTO tol_uploaded_csv_files
           (original_file_name, stored_file_name, table_file_name, delimiter,
            has_header_row, column_names, row_count, byte_size, uploaded_by_user_id, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        input.originalFileName,
        input.storedFileName,
        input.tableFileName,
        input.delimiter,
        input.hasHeaderRow ? 1 : 0,
        JSON.stringify(input.columnNames),
        input.rowCount,
        input.byteSize,
        input.uploadedByUserId,
      );

    const created = this.getById(Number(result.lastInsertRowid));
    // Inserted on this same connection, so this cannot miss — but it is checked
    // rather than asserted away, so a later change to the SELECT surfaces here
    // instead of as a confusing crash downstream.
    if (!created) throw new Error("Failed to read back the upload just recorded.");
    return created;
  }

  updateRowCount(id: number, rowCount: number): void {
    this.db
      .prepare("UPDATE tol_uploaded_csv_files SET row_count = ? WHERE id = ?")
      .run(rowCount, id);
  }

  delete(id: number): boolean {
    const result = this.db.prepare("DELETE FROM tol_uploaded_csv_files WHERE id = ?").run(id);
    return result.changes > 0;
  }
}

function toDomain(row: UploadedCsvFileRow): UploadedCsvFile {
  return {
    id: row.id,
    originalFileName: row.original_file_name,
    storedFileName: row.stored_file_name,
    tableFileName: row.table_file_name,
    // Forgiving on read, deliberately: these rows are reachable from the admin
    // SQL Explorer, and a hand-edited delimiter should degrade to a comma
    // rather than make the file unopenable. Same reasoning as
    // `resolveToolsSettings` clamping instead of throwing.
    delimiter: isCsvDelimiter(row.delimiter) ? row.delimiter : DEFAULT_DELIMITER,
    hasHeaderRow: row.has_header_row === 1,
    columnNames: parseColumnNames(row.column_names),
    rowCount: row.row_count,
    byteSize: row.byte_size,
    uploadedByUserId: row.uploaded_by_user_id,
    uploadedByName: row.uploaded_by_name,
    uploadedAt: row.uploaded_at,
  };
}

/**
 * The stored column list, which must come back as an array of strings.
 *
 * Written by `create` as JSON and never by hand — but it is a TEXT column in a
 * database an admin can edit, so a malformed value resolves to no columns
 * rather than throwing. The caller then reports "no columns" on that one file
 * instead of the whole picker failing to render.
 */
function parseColumnNames(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((name): name is string => typeof name === "string");
  } catch {
    return [];
  }
}
