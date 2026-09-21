import Database from "better-sqlite3";
import type { CsvTableStore } from "./ports";
import type { CsvBrowsedPage, CsvBrowsedRow, CsvCellChanges } from "./types";

/**
 * The sidecar's one table. Fixed, not derived from the file's name — the
 * sidecar holds exactly one upload, so there is nothing to disambiguate.
 */
const ROWS_TABLE = "csv_rows";

/**
 * How many rows are inserted per transaction at import, and read per batch on
 * export.
 *
 * Both are about not holding a large file in memory at once. 5000 is a few
 * hundred KB of text at typical widths and keeps a million-row import to a
 * couple of hundred transactions rather than one enormous one.
 */
const BATCH_SIZE = 5000;

/**
 * Reads and writes the rows of one uploaded delimited file, in that file's own
 * SQLite sidecar — never the app's database.
 *
 * Every method takes the sidecar's path and opens a connection for the length
 * of that one call. That is deliberately unlike every other repository here,
 * which holds the app's long-lived connection, and it is the same choice
 * `sqlite-browser`'s `BetterSqliteForeignDatabaseReader` makes for the same
 * reason: there is no ambient database to get confused with, so nothing a
 * caller passes can resolve against `myhomebase.db`.
 *
 * Connections close in a `finally`. A sidecar left open would be locked, and
 * on Windows the reader could then not delete their own upload.
 *
 * **Column identity is positional, not by name.** The sidecar's columns are
 * `c0..cN` and the file's real names live in the app row, so a header like
 * `select` or `1st Qtr` or `Total (2)` needs no quoting gymnastics and cannot
 * collide with `rowid`. Callers pass `columnNames` in file order and this maps
 * between the two.
 */
export class BetterSqliteCsvTableStore implements CsvTableStore {
  create(sidecarPath: string, columnNames: string[], rows: string[][]): number {
    return this.withDatabase(sidecarPath, false, (db) => {
      const columns = columnKeys(columnNames.length);

      // WITHOUT ROWID is deliberately *not* used: the rowid is the row identity
      // every edit and delete addresses, exactly as in the SQLite browser.
      db.exec(
        `CREATE TABLE ${ROWS_TABLE} (${columns.map((column) => `${column} TEXT`).join(", ")})`,
      );

      const placeholders = columns.map(() => "?").join(", ");
      const insert = db.prepare(
        `INSERT INTO ${ROWS_TABLE} (${columns.join(", ")}) VALUES (${placeholders})`,
      );

      const insertBatch = db.transaction((batch: string[][]) => {
        for (const row of batch) {
          // Padded to the column count: a short row is kept as a row with
          // trailing NULLs rather than dropped, because a malformed line is
          // exactly what someone opens this tool to find.
          insert.run(columns.map((_unused, index) => row[index] ?? null));
        }
      });

      for (let start = 0; start < rows.length; start += BATCH_SIZE) {
        insertBatch(rows.slice(start, start + BATCH_SIZE));
      }

      return rows.length;
    });
  }

  read(
    sidecarPath: string,
    columnNames: string[],
    limit: number,
    offset: number,
  ): CsvBrowsedPage {
    return this.withDatabase(sidecarPath, true, (db) => {
      const columns = columnKeys(columnNames.length);

      const counted = db.prepare(`SELECT COUNT(*) AS count FROM ${ROWS_TABLE}`).get() as {
        count: number;
      };

      // Ordered by rowid so paging is stable: without an ORDER BY, SQLite may
      // return rows in any order and page 2 could repeat a row from page 1.
      const rawRows = db
        .prepare(
          `SELECT rowid AS row_id, ${columns.join(", ")}
             FROM ${ROWS_TABLE} ORDER BY rowid LIMIT ? OFFSET ?`,
        )
        .all(limit, offset) as Record<string, unknown>[];

      const rows: CsvBrowsedRow[] = rawRows.map((raw) => ({
        rowId: Number(raw.row_id),
        cells: columns.map((column) => toCellValue(raw[column])),
      }));

      return {
        // Filled in by the use-case, which is what knows the file's id — the
        // store only ever sees a path.
        fileId: 0,
        columns: columnNames,
        rows,
        totalRows: counted.count,
        returnedRows: rows.length,
        offset,
      };
    });
  }

  *readAll(sidecarPath: string, columnNames: string[]): Generator<(string | null)[]> {
    const columns = columnKeys(columnNames.length);

    // Unlike every other method here the connection cannot be closed in a
    // `finally` around one call: a generator hands control back to the caller
    // between batches. It is closed when the generator finishes or is disposed
    // — `try/finally` around the loop covers a caller that stops early, which
    // a streamed response does when the client hangs up.
    const db = new Database(sidecarPath, { readonly: true, fileMustExist: true });
    try {
      const statement = db.prepare(
        `SELECT ${columns.join(", ")} FROM ${ROWS_TABLE} ORDER BY rowid LIMIT ? OFFSET ?`,
      );

      for (let offset = 0; ; offset += BATCH_SIZE) {
        const batch = statement.all(BATCH_SIZE, offset) as Record<string, unknown>[];
        if (batch.length === 0) return;

        for (const raw of batch) {
          yield columns.map((column) => toCellValue(raw[column]));
        }

        // A short batch is the last one, so the next query would be wasted.
        if (batch.length < BATCH_SIZE) return;
      }
    } finally {
      db.close();
    }
  }

  update(
    sidecarPath: string,
    columnNames: string[],
    rowIds: number[],
    changes: CsvCellChanges,
  ): number {
    if (rowIds.length === 0) return 0;

    return this.withDatabase(sidecarPath, false, (db) => {
      // A change is keyed by the file's column *name*; the sidecar is keyed by
      // position. This is the only place the two meet.
      //
      // It is also the guard that keeps a caller's string out of the SQL text:
      // a name that is not in `columnNames` maps to no position and is
      // dropped, so what gets interpolated is always a generated `cN` and
      // never anything that came in from outside. The use-case has already
      // rejected unknown names with an error — this is the second guard, and
      // the one that makes the interpolation safe.
      const assignments: string[] = [];
      const values: (string | null)[] = [];
      for (const [name, value] of Object.entries(changes)) {
        const index = columnNames.indexOf(name);
        if (index === -1) continue;
        assignments.push(`${columnKey(index)} = ?`);
        values.push(value);
      }

      if (assignments.length === 0) return 0;

      const statement = db.prepare(
        `UPDATE ${ROWS_TABLE} SET ${assignments.join(", ")} WHERE rowid = ?`,
      );

      // One transaction, so a partial write cannot be left behind.
      const updateAll = db.transaction((ids: number[]) => {
        let updated = 0;
        for (const id of ids) updated += statement.run(...values, id).changes;
        return updated;
      });

      return updateAll(rowIds);
    });
  }

  deleteRows(sidecarPath: string, rowIds: number[]): number {
    if (rowIds.length === 0) return 0;

    return this.withDatabase(sidecarPath, false, (db) => {
      const statement = db.prepare(`DELETE FROM ${ROWS_TABLE} WHERE rowid = ?`);
      const deleteAll = db.transaction((ids: number[]) => {
        let deleted = 0;
        for (const id of ids) deleted += statement.run(id).changes;
        return deleted;
      });

      return deleteAll(rowIds);
    });
  }

  countRows(sidecarPath: string): number {
    return this.withDatabase(sidecarPath, true, (db) => {
      const counted = db.prepare(`SELECT COUNT(*) AS count FROM ${ROWS_TABLE}`).get() as {
        count: number;
      };
      return counted.count;
    });
  }

  /** Opens the sidecar, runs `work`, and always closes again. */
  private withDatabase<T>(
    sidecarPath: string,
    readOnly: boolean,
    work: (db: Database.Database) => T,
  ): T {
    let db: Database.Database | undefined;
    try {
      // `fileMustExist` only when reading: `create` is the one call that makes
      // the file, and every other path has had `exists` checked by the caller.
      db = new Database(sidecarPath, { readonly: readOnly, fileMustExist: readOnly });
      return work(db);
    } finally {
      db?.close();
    }
  }
}

/** `c0`, `c1`, … — the sidecar's column for the nth file column. */
function columnKey(index: number): string {
  return `c${index}`;
}

/** The first `count` sidecar column keys. */
function columnKeys(count: number): string[] {
  return Array.from({ length: count }, (_unused, index) => columnKey(index));
}

/** Narrows a raw SQLite cell to what a delimited file can hold. */
function toCellValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : String(value);
}
