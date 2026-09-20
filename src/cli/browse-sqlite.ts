import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  deleteRows,
  deleteUploadedDatabase,
  getMaxUploadBytes,
  listTablesIn,
  listUploadedDatabases,
  readTableRows,
  uploadDatabase,
  type SqliteBrowserDeps,
} from "@/lib/sqlite-browser";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * The Tools module's SQLite File Browser, from the terminal — the same
 * use-cases the web view calls, through the same `deps`.
 *
 *   browse-sqlite                                   list the uploaded files
 *   browse-sqlite --upload ./chinook.db [--user 1]  add one
 *   browse-sqlite --db 3                            list its tables
 *   browse-sqlite --db 3 --table customers          read that table
 *   browse-sqlite --db 3 --table customers --delete "4,9"
 *   browse-sqlite --db 3 --remove                   forget the file and delete it
 *
 * `--delete` takes SQLite rowids, which is what the grid's checkboxes address
 * too — `--table` on its own prints them in the first column so they can be
 * copied straight back in.
 */

const browserDeps: SqliteBrowserDeps = {
  repo: deps.uploadedDatabaseRepo,
  fileStore: deps.sqliteFileStore,
  reader: deps.foreignDatabaseReader,
};

export async function browseSqliteCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  try {
    if (flags.upload) {
      await runUpload(flags.upload, flags.user);
      return;
    }

    if (!flags.db) {
      runList();
      return;
    }

    const databaseId = Number(flags.db);
    if (!Number.isInteger(databaseId) || databaseId <= 0) {
      console.error("--db takes the numeric id from the list.");
      process.exitCode = 1;
      return;
    }

    if ("remove" in flags) {
      await runRemove(databaseId);
      return;
    }

    if (!flags.table) {
      await runTables(databaseId);
      return;
    }

    if (flags.delete) {
      await runDelete(databaseId, flags.table, flags.delete);
      return;
    }

    await runRead(databaseId, flags.table);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function runList(): void {
  const databases = listUploadedDatabases(deps.uploadedDatabaseRepo);

  if (databases.length === 0) {
    console.log("No SQLite files have been uploaded.");
    console.log("Add one with: browse-sqlite --upload ./some.db");
    return;
  }

  console.log(`${databases.length} uploaded file${databases.length === 1 ? "" : "s"}:`);
  for (const database of databases) {
    const size = `${(database.byteSize / 1024).toFixed(0)} KB`;
    console.log(
      `  [${database.id}] ${database.originalFileName} — ${size}, ${database.uploadedByName ?? "Unknown"}, ${database.uploadedAt}`,
    );
  }
}

async function runUpload(filePath: string, user: string | undefined): Promise<void> {
  const bytes = new Uint8Array(await readFile(filePath));
  // An unparseable --user is treated as "not attributed" rather than as an
  // error: the attribution is a nicety, and refusing the whole upload over it
  // would be the wrong trade.
  const uploadedByUserId = Number.isInteger(Number(user)) && Number(user) > 0 ? Number(user) : null;

  // The same configured cap the web upload enforces, so the two adapters can
  // never disagree about what is too large.
  const maxBytes = getMaxUploadBytes(deps.moduleRepo, deps.moduleSettingsRepo);

  const created = await uploadDatabase(
    { originalFileName: path.basename(filePath), bytes, uploadedByUserId },
    browserDeps,
    maxBytes,
  );

  console.log(`Uploaded ${created.originalFileName} as [${created.id}].`);
}

async function runTables(databaseId: number): Promise<void> {
  const tables = await listTablesIn(databaseId, browserDeps);

  if (tables.length === 0) {
    console.log("That file holds no tables.");
    return;
  }

  for (const table of tables) {
    const readOnly = table.canDelete ? "" : "  (read-only — no rowid)";
    console.log(`  ${table.name} — ${table.rowCount} rows, ${table.columns.length} cols${readOnly}`);
  }
}

async function runRead(databaseId: number, tableName: string): Promise<void> {
  const page = await readTableRows({ databaseId, tableName }, browserDeps);

  console.log(["rowid", ...page.columns].join("\t"));
  for (const row of page.rows) {
    console.log([row.rowId ?? "-", ...row.cells.map((cell) => (cell === null ? "NULL" : cell))].join("\t"));
  }

  if (page.returnedRows < page.totalRows) {
    console.log(`\nShowing ${page.returnedRows} of ${page.totalRows} rows.`);
  }
}

async function runDelete(databaseId: number, tableName: string, list: string): Promise<void> {
  const rowIds = list
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value));

  if (rowIds.length === 0) {
    console.error('--delete takes a comma-separated list of rowids, e.g. --delete "4,9".');
    process.exitCode = 1;
    return;
  }

  const result = await deleteRows({ databaseId, tableName, rowIds }, browserDeps);
  console.log(`Deleted ${result.deletedCount} row(s) from ${result.tableName}.`);
}

async function runRemove(databaseId: number): Promise<void> {
  const removed = await deleteUploadedDatabase(databaseId, browserDeps);

  if (!removed) {
    console.error(`No uploaded database with the id ${databaseId}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Removed [${databaseId}].`);
}
