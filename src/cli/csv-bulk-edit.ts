import {
  bulkEditRows,
  getEntryById,
  nonEditableColumns,
  readEntryData,
  type CsvBulkEditChanges,
} from "@/lib/csv-analytics";
import { deps } from "@/lib/wiring";
import { messageOf } from "./error-message";
import { parseFlags } from "./parse-flags";

/**
 * Bulk edit a CSV dataset's rows from the terminal — the same use-case the Dashboard's
 * Data card drives, per ARCHITECTURE.md's rule that every use-case is callable from
 * both places.
 *
 *   csv-bulk-edit columns --entry 3
 *   csv-bulk-edit rows --entry 3 [--limit 20]
 *   csv-bulk-edit apply --entry 3 --rows 4,5,6 --set "city=Oslo" --set "amount=100"
 *   csv-bulk-edit apply --entry 3 --all --set "processed=1"
 *
 * `rows` prints each row with its rowid, which is what `--rows` takes: a rowid is the
 * only stable handle on a row (see `CsvEntryData.rowIds`), and the grid uses the same
 * one. `--all` covers every row in the table, for the "stamp a value on the whole
 * dataset" case that would otherwise mean pasting thousands of ids.
 *
 * `--set` repeats, once per column. `parseFlags` keeps only the last occurrence of a
 * key, so it is re-scanned from argv directly below — the same trick `csv-views` uses
 * for `--where`. `--clear` names a column to set to NULL, which `--set col=` also does;
 * both exist because an empty `--set` is easy to write by accident.
 */
export async function csvBulkEditCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const flags = parseFlags(rest);

  switch (subcommand) {
    case "columns":
      return printColumns(flags.entry);
    case "rows":
      return printRows(flags.entry, flags.limit);
    case "apply":
      return apply(rest, flags);
    default:
      console.log(
        [
          "Usage:",
          "  csv-bulk-edit columns --entry <id>",
          "  csv-bulk-edit rows --entry <id> [--limit <n>]",
          '  csv-bulk-edit apply --entry <id> --rows 1,2,3 --set "col=value" [--set ...] [--clear col]',
          '  csv-bulk-edit apply --entry <id> --all --set "col=value"',
        ].join("\n"),
      );
  }
}

/** Resolves and validates the --entry flag, printing why if it can't. */
function resolveEntry(rawId: string | undefined) {
  const entryId = Number(rawId);
  if (!Number.isInteger(entryId) || entryId <= 0) {
    console.error("Pass --entry <id>. Run list-csv-analytics to see the datasets.");
    return undefined;
  }
  const entry = getEntryById(deps.csvAnalyticsRepo, entryId);
  if (!entry) {
    console.error(`No CSV analytic entry with id ${entryId}.`);
    return undefined;
  }
  return entry;
}

function printColumns(rawEntryId: string | undefined): void {
  const entry = resolveEntry(rawEntryId);
  if (!entry) return;

  const locked = new Set(nonEditableColumns(entry));
  console.log(`#${entry.id} ${entry.name} — table ${entry.tableName}, ${entry.rowCount} rows`);
  for (const column of entry.columns) {
    const note = locked.has(column.name) ? "  (primary key — not editable)" : "";
    console.log(`  ${column.name} : ${column.type}  "${column.sourceHeader}"${note}`);
  }
}

function printRows(rawEntryId: string | undefined, rawLimit: string | undefined): void {
  const entry = resolveEntry(rawEntryId);
  if (!entry) return;

  const limit = rawLimit ? Number(rawLimit) : 20;
  const data = readEntryData(
    deps.csvAnalyticsRepo,
    entry.id,
    Number.isFinite(limit) && limit > 0 ? limit : 20,
  );

  console.log(["rowid", ...data.columns.map((column) => column.name)].join("\t"));
  data.rows.forEach((row, index) => {
    console.log([data.rowIds[index], ...row.map((value) => value ?? "")].join("\t"));
  });
  console.log(`\n${data.rows.length} of ${entry.rowCount} row(s).`);
}

async function apply(rest: string[], flags: Record<string, string>): Promise<void> {
  const entry = resolveEntry(flags.entry);
  if (!entry) return;

  // Every --set, not just the last: parseFlags collapses repeats.
  const changes: CsvBulkEditChanges = {};
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--set") {
      const raw = rest[index + 1] ?? "";
      const separator = raw.indexOf("=");
      if (separator <= 0) {
        console.error(`Each --set needs "column=value" — got "${raw}".`);
        return;
      }
      changes[raw.slice(0, separator)] = raw.slice(separator + 1);
    }
    if (rest[index] === "--clear") {
      const column = rest[index + 1] ?? "";
      if (column === "") {
        console.error("--clear needs a column name.");
        return;
      }
      changes[column] = null;
    }
  }

  if (Object.keys(changes).length === 0) {
    console.error('Pass at least one --set "column=value" or --clear <column>.');
    return;
  }

  const useAll = rest.includes("--all");
  let rowIds: number[];
  if (useAll) {
    rowIds = readEntryData(deps.csvAnalyticsRepo, entry.id).rowIds;
  } else {
    rowIds = (flags.rows ?? "")
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  if (rowIds.length === 0) {
    console.error("Pass --rows 1,2,3 (see `csv-bulk-edit rows`) or --all.");
    return;
  }

  try {
    const result = bulkEditRows(deps.csvAnalyticsRepo, entry.id, rowIds, changes);
    console.log(
      `Updated ${result.updated} row(s) in ${entry.tableName}: ${result.fields.join(", ")}.`,
    );
  } catch (error) {
    console.error(messageOf(error));
  }
}
