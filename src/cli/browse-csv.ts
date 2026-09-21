import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  deleteCsvRows,
  deleteUploadedCsvFile,
  editCsvRows,
  exportCsvFileText,
  importCsvFileText,
  isCsvDelimiter,
  listUploadedCsvFiles,
  readCsvRows,
  type CsvCellChanges,
  type CsvFileBrowserDeps,
} from "@/lib/csv-file-browser";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * The Tools module's CSV File Browser, from the terminal — the same use-cases
 * the web view calls, through the same `deps`.
 *
 *   browse-csv                                     list the uploaded files
 *   browse-csv --upload ./people.csv [--user 1]    add one
 *   browse-csv --upload ./log.txt --delimiter tab --no-header
 *   browse-csv --file 3                            read its rows
 *   browse-csv --file 3 --offset 1000              the next slice
 *   browse-csv --file 3 --set "city=Bath" --rows "4,9"
 *   browse-csv --file 3 --delete "4,9"
 *   browse-csv --file 3 --export                   write it back out, edits and all
 *   browse-csv --file 3 --remove                   forget the file and delete it
 *
 * `--rows` and `--delete` take the ids printed in the first column by a plain
 * `--file` read, so they can be copied straight back in — the same ids the
 * grid's checkboxes address.
 *
 * `--set` may be repeated in spirit by passing several `key=value` pairs
 * separated by `;`. A pair with an empty value clears the column, matching
 * what a ticked-but-blank column does in the bulk edit dialog.
 */

const browserDeps: CsvFileBrowserDeps = {
  repo: deps.uploadedCsvFileRepo,
  fileStore: deps.csvFileStore,
  tableStore: deps.csvTableStore,
};

export async function browseCsvCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  try {
    if (flags.upload) {
      await runUpload(flags);
      return;
    }

    if (!flags.file) {
      runList();
      return;
    }

    const fileId = Number(flags.file);
    if (!Number.isInteger(fileId) || fileId <= 0) {
      console.error("--file takes the numeric id from the list.");
      process.exitCode = 1;
      return;
    }

    if ("remove" in flags) {
      await runRemove(fileId);
      return;
    }

    if ("export" in flags) {
      await runExport(fileId);
      return;
    }

    if (flags.delete) {
      await runDelete(fileId, flags.delete);
      return;
    }

    if (flags.set) {
      await runEdit(fileId, flags.set, flags.rows);
      return;
    }

    await runRead(fileId, flags.offset);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function runList(): void {
  const files = listUploadedCsvFiles(deps.uploadedCsvFileRepo);

  if (files.length === 0) {
    console.log("No CSV or text files have been uploaded.");
    console.log("Add one with: browse-csv --upload ./some.csv");
    return;
  }

  console.log(`${files.length} uploaded file${files.length === 1 ? "" : "s"}:`);
  for (const file of files) {
    const size = `${(file.byteSize / 1024).toFixed(0)} KB`;
    console.log(
      `  [${file.id}] ${file.originalFileName} — ${file.rowCount} rows, ${file.columnNames.length} cols, ${size}, ${file.uploadedByName ?? "Unknown"}, ${file.uploadedAt}`,
    );
  }
}

async function runUpload(flags: Record<string, string>): Promise<void> {
  const filePath = flags.upload;
  const text = await readFile(filePath, "utf8");

  // An unparseable --user is treated as "not attributed" rather than as an
  // error: the attribution is a nicety, and refusing the whole upload over it
  // would be the wrong trade. Same rule as browse-sqlite.
  const user = Number(flags.user);
  const uploadedByUserId = Number.isInteger(user) && user > 0 ? user : null;

  const created = await importCsvFileText(
    {
      originalFileName: path.basename(filePath),
      text,
      uploadedByUserId,
      options: {
        delimiter: parseDelimiterFlag(flags.delimiter),
        hasHeaderRow: !("no-header" in flags),
      },
    },
    browserDeps,
  );

  console.log(
    `Uploaded ${created.originalFileName} as [${created.id}] — ${created.rowCount} rows, columns: ${created.columnNames.join(", ")}.`,
  );
}

async function runRead(fileId: number, offsetFlag: string | undefined): Promise<void> {
  const offset = Number(offsetFlag);
  const page = await readCsvRows(
    { fileId, offset: Number.isInteger(offset) && offset > 0 ? offset : 0 },
    browserDeps,
  );

  // Tab-separated regardless of the file's own delimiter: this is terminal
  // output to read, not a file to re-import. Use --export for that.
  console.log(["id", ...page.columns].join("\t"));
  for (const row of page.rows) {
    console.log([row.rowId, ...row.cells.map((cell) => cell ?? "")].join("\t"));
  }
  console.log(
    `\n${page.offset + 1}–${page.offset + page.returnedRows} of ${page.totalRows} rows.`,
  );
}

async function runEdit(
  fileId: number,
  setFlag: string,
  rowsFlag: string | undefined,
): Promise<void> {
  const rowIds = parseIds(rowsFlag ?? "");
  if (rowIds.length === 0) {
    console.error('--set needs --rows "4,9" saying which rows to write.');
    process.exitCode = 1;
    return;
  }

  const changes = parseChanges(setFlag);
  const result = await editCsvRows({ fileId, rowIds, changes }, browserDeps);

  console.log(
    `Updated ${result.updatedCount} row${result.updatedCount === 1 ? "" : "s"} (${result.fields.join(", ")}).`,
  );
}

async function runDelete(fileId: number, deleteFlag: string): Promise<void> {
  const rowIds = parseIds(deleteFlag);
  if (rowIds.length === 0) {
    console.error('--delete takes row ids, e.g. --delete "4,9".');
    process.exitCode = 1;
    return;
  }

  const result = await deleteCsvRows({ fileId, rowIds }, browserDeps);
  console.log(
    `Deleted ${result.deletedCount} row${result.deletedCount === 1 ? "" : "s"}; ${result.remainingRows} left.`,
  );
}

async function runExport(fileId: number): Promise<void> {
  // Straight to stdout so it can be redirected to a file or piped onwards,
  // written a chunk at a time exactly as the web route streams it.
  for await (const chunk of exportCsvFileText(fileId, browserDeps)) {
    process.stdout.write(chunk);
  }
}

async function runRemove(fileId: number): Promise<void> {
  const removed = await deleteUploadedCsvFile(fileId, browserDeps);
  console.log(removed ? `Removed [${fileId}].` : `No uploaded file [${fileId}].`);
}

/**
 * `--delimiter comma|tab|semicolon|pipe`, or the character itself.
 *
 * Names as well as characters because a tab cannot be typed as an argument and
 * a `;` or `|` needs shell quoting to survive. An unrecognised value yields
 * `undefined`, which means "sniff it" — the same as not passing the flag.
 */
function parseDelimiterFlag(value: string | undefined) {
  if (!value) return undefined;

  const named: Record<string, string> = {
    comma: ",",
    tab: "\t",
    semicolon: ";",
    pipe: "|",
  };
  const candidate = named[value.toLowerCase()] ?? value;

  return isCsvDelimiter(candidate) ? candidate : undefined;
}

/** `"4,9"` -> `[4, 9]`, ignoring anything that is not a number. */
function parseIds(value: string): number[] {
  return value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id));
}

/**
 * `"city=Bath;note="` -> `{ city: "Bath", note: "" }`.
 *
 * An empty value is kept rather than dropped: clearing a column is a real
 * edit, and it is what a ticked-but-blank column does in the web dialog.
 * Splitting on the *first* `=` only, so a value may contain one.
 */
function parseChanges(value: string): CsvCellChanges {
  const changes: CsvCellChanges = {};

  for (const pair of value.split(";")) {
    if (pair.trim().length === 0) continue;
    const separator = pair.indexOf("=");
    if (separator === -1) continue;

    const column = pair.slice(0, separator).trim();
    if (column.length > 0) changes[column] = pair.slice(separator + 1);
  }

  return changes;
}
