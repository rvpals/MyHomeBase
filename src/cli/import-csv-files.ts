// Pool several CSV files into one dataset, from the terminal.
//
// The CLI peer of CSV Analysis -> Import Files. Same use-cases, same validation, same
// result — per ARCHITECTURE.md, a use-case that can't be driven from a terminal has
// logic living in the wrong layer. This is also how a pooled import is exercised
// without a browser.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  appendPooledFiles,
  importPooledFiles,
  planPooledImport,
  suggestSourceName,
  type CsvImportFileInput,
} from "@/lib/csv-analytics";
import { deps } from "@/lib/wiring";

const USAGE = `Usage:
  import-csv-files plan   <file.csv> [more.csv ...] [--label <name>]
  import-csv-files create --name <name> --table <base> <file.csv> [more.csv ...]
                          [--label <name>] [--value <file.csv>=<value>] [--description <text>]
  import-csv-files append --entry <id> <file.csv> [more.csv ...]
                          [--value <file.csv>=<value>]

  --label   A column describing each file, e.g. "Room". Repeatable (max 3).
  --value   That label's value for one file. Repeatable. Defaults to the name
            suggested by the filename, which is usually what you want.

Examples:
  import-csv-files plan "Master Bathroom_export_202609221408.csv" Basement.csv
  import-csv-files create --name "Humidity" --table humidity --label Room \\
      "Master Bathroom_export_202609221408.csv" Basement.csv`;

interface ParsedArgs {
  files: string[];
  labels: string[];
  /** filename -> the value typed for it (applied to every label column). */
  values: Map<string, string>;
  name?: string;
  table?: string;
  description?: string;
  entryId?: number;
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = { files: [], labels: [], values: new Map() };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--label":
        parsed.labels.push(args[++i] ?? "");
        break;
      case "--name":
        parsed.name = args[++i];
        break;
      case "--table":
        parsed.table = args[++i];
        break;
      case "--description":
        parsed.description = args[++i];
        break;
      case "--entry":
        parsed.entryId = Number(args[++i]);
        break;
      case "--value": {
        const pair = args[++i] ?? "";
        const split = pair.indexOf("=");
        if (split < 0) throw new Error(`--value needs <file.csv>=<value>, got "${pair}".`);
        parsed.values.set(pair.slice(0, split), pair.slice(split + 1));
        break;
      }
      default:
        parsed.files.push(arg);
    }
  }
  return parsed;
}

/** Reads each path and assigns a value per label column, defaulting from the filename. */
function readFiles(parsed: ParsedArgs, labelNames: string[]): CsvImportFileInput[] {
  return parsed.files.map((path) => {
    const fileName = basename(path);
    const explicit = parsed.values.get(fileName) ?? parsed.values.get(path);
    const value = explicit ?? suggestSourceName(fileName);

    const labelValues: Record<string, string> = {};
    labelNames.forEach((name) => {
      labelValues[name] = value;
    });

    return { fileName, fileText: readFileSync(path, "utf8"), labelValues };
  });
}

/** Label column names as the library will slugify them, so --value lands on the right key. */
function labelColumnNames(labels: string[]): string[] {
  return labels
    .map((label) => label.trim())
    .filter((label) => label !== "")
    .map((label) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""));
}

export async function importCsvFilesCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "help") {
    console.log(USAGE);
    return;
  }

  const parsed = parseArgs(rest);
  if (parsed.files.length === 0) {
    console.error("Name at least one CSV file.\n");
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  const labelNames = labelColumnNames(parsed.labels);

  switch (subcommand) {
    case "plan": {
      const plan = planPooledImport(
        parsed.files.map((path) => ({
          fileName: basename(path),
          fileText: readFileSync(path, "utf8"),
        })),
        parsed.labels,
      );

      console.log(`Columns from the file (${plan.dataColumns.length}):`);
      plan.dataColumns.forEach((column) => {
        console.log(`  ${column.name} (${column.type}) — "${column.sourceHeader}"`);
      });
      console.log(`Source columns (${plan.sourceColumns.length}):`);
      plan.sourceColumns.forEach((column) => {
        console.log(`  ${column.name} (${column.kind}) — "${column.label}"`);
      });
      console.log(`Files (${plan.files.length}):`);
      plan.files.forEach((file) => {
        console.log(`  ${file.fileName}: ${file.rowCount} rows → "${file.suggestedSourceName}"`);
      });
      console.log(`Total: ${plan.totalRows} rows.`);

      if (plan.headerMismatches.length > 0) {
        console.error("\nThese files cannot be pooled together:");
        plan.headerMismatches.forEach((mismatch) => {
          console.error(`  ${mismatch.fileName} ${mismatch.reason}`);
        });
        process.exitCode = 1;
      }
      return;
    }

    case "create": {
      if (!parsed.name || !parsed.table) {
        console.error("create needs --name and --table.\n");
        console.log(USAGE);
        process.exitCode = 1;
        return;
      }
      const entry = importPooledFiles(deps.csvAnalyticsRepo, {
        name: parsed.name,
        description: parsed.description,
        tableBaseName: parsed.table,
        files: readFiles(parsed, labelNames),
        labels: parsed.labels,
      });
      console.log(
        `Created #${entry.id} "${entry.name}" — table ${entry.tableName}, ${entry.rowCount} rows ` +
          `from ${parsed.files.length} file(s).`,
      );
      return;
    }

    case "append": {
      if (parsed.entryId === undefined || Number.isNaN(parsed.entryId)) {
        console.error("append needs --entry <id>.\n");
        console.log(USAGE);
        process.exitCode = 1;
        return;
      }
      const existing = deps.csvAnalyticsRepo.getEntryById(parsed.entryId);
      if (!existing) {
        console.error(`No CSV analytic entry #${parsed.entryId}.`);
        process.exitCode = 1;
        return;
      }
      // Reuse the dataset's own label columns — append cannot redefine them.
      const names = existing.sourceColumns
        .filter((column) => column.kind === "label")
        .map((column) => column.name);

      const result = appendPooledFiles(deps.csvAnalyticsRepo, {
        entryId: parsed.entryId,
        files: readFiles(parsed, names),
      });
      console.log(
        `Added ${result.ingestResult.inserted} rows to "${result.entry.name}" ` +
          `(${result.entry.rowCount} total).`,
      );
      return;
    }

    default:
      console.error(`Unknown subcommand "${subcommand}".\n`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}
