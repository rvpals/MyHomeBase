import type Database from "better-sqlite3";
import type { UploadedDatabaseRepository, UploadedDatabaseWriteData } from "./ports";
import type { UploadedDatabase } from "./types";

interface UploadedDatabaseRow {
  id: number;
  original_file_name: string;
  stored_file_name: string;
  byte_size: number;
  uploaded_by_user_id: number | null;
  uploaded_by_name: string | null;
  uploaded_at: string;
}

// Every read LEFT JOINs `sys_users` for the uploader's display name. LEFT
// rather than INNER: an upload outlives the account that made it, and deleting
// a user must not silently empty the shared list. A missing user reads as
// "Unknown" in the view instead of dropping the row. Same pattern as
// `gam_scores`.
const SELECT_UPLOADS = `
  SELECT u.id,
         u.original_file_name,
         u.stored_file_name,
         u.byte_size,
         u.uploaded_by_user_id,
         s.full_name AS uploaded_by_name,
         u.uploaded_at
    FROM tol_uploaded_databases u
    LEFT JOIN sys_users s ON s.id = u.uploaded_by_user_id`;

/**
 * The only file in this module that knows SQL against the *app's* database.
 *
 * It stores metadata about uploaded files and nothing else. Reading inside an
 * uploaded file is `foreign-db.ts`'s job, over a different connection.
 */
export class SqliteUploadedDatabaseRepository implements UploadedDatabaseRepository {
  constructor(private readonly db: Database.Database) {}

  list(): UploadedDatabase[] {
    const rows = this.db
      .prepare(`${SELECT_UPLOADS} ORDER BY u.uploaded_at DESC, u.id DESC`)
      .all() as UploadedDatabaseRow[];
    return rows.map(toDomain);
  }

  getById(id: number): UploadedDatabase | undefined {
    const row = this.db.prepare(`${SELECT_UPLOADS} WHERE u.id = ?`).get(id) as
      | UploadedDatabaseRow
      | undefined;
    return row ? toDomain(row) : undefined;
  }

  create(input: UploadedDatabaseWriteData): UploadedDatabase {
    const result = this.db
      .prepare(
        `INSERT INTO tol_uploaded_databases
           (original_file_name, stored_file_name, byte_size, uploaded_by_user_id, uploaded_at)
         VALUES (?, ?, ?, ?, datetime('now'))`,
      )
      .run(
        input.originalFileName,
        input.storedFileName,
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

  delete(id: number): boolean {
    const result = this.db.prepare("DELETE FROM tol_uploaded_databases WHERE id = ?").run(id);
    return result.changes > 0;
  }
}

function toDomain(row: UploadedDatabaseRow): UploadedDatabase {
  return {
    id: row.id,
    originalFileName: row.original_file_name,
    storedFileName: row.stored_file_name,
    byteSize: row.byte_size,
    uploadedByUserId: row.uploaded_by_user_id,
    uploadedByName: row.uploaded_by_name,
    uploadedAt: row.uploaded_at,
  };
}
