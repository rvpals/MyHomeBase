import { readFileSync } from "node:fs";
import { listNamedMappings, parseCsv } from "@/lib/csv-import";
import { autoMapTbillHeaders, importTbillCsv, planTbillImport } from "@/lib/treasury-bills";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

// Thin adapter: read a CSV file, resolve a mapping (a saved named mapping, or an
// auto-map from the file's headers), run the import, and print the summary.
// The same use-case the Investments CSV Import screen calls, and the same saved
// mappings — they live in `csv_named_mappings` under the "TBill" import type, so a
// mapping built in the browser is usable here by name. Mirrors import-recipes-csv.ts.
export async function importTbillsCsvCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const filePath = flags.file;

  if (!filePath) {
    console.error(
      "Usage: import-tbills-csv --file <path> [--mapping <saved-mapping-name>] " +
        "[--allow-duplicates] [--dry-run]",
    );
    process.exitCode = 1;
    return;
  }

  // Duplicates are skipped unless asked for, matching the import screen's default:
  // re-running the same import should be a no-op.
  const skipDuplicates = !("allow-duplicates" in flags);

  try {
    const fileText = readFileSync(String(filePath), "utf8");

    let columnMapping;
    let fieldOptions;
    if (flags.mapping) {
      const named = listNamedMappings(deps.csvImportMappingRepo, "TBill").find(
        (mapping) => mapping.name === flags.mapping,
      );
      if (!named) {
        console.error(`No saved T-Bill mapping named "${flags.mapping}".`);
        process.exitCode = 1;
        return;
      }
      columnMapping = named.columnMapping;
      fieldOptions = named.fieldOptions;
    } else {
      ({ columnMapping, fieldOptions } = autoMapTbillHeaders(parseCsv(fileText).headers));
    }

    // --dry-run is the CLI's version of the screen's plan step: the same walk
    // decides each row, so what it prints is what a real run would then do.
    if ("dry-run" in flags) {
      const plan = planTbillImport(deps.tbillRepo, fileText, columnMapping, {
        fieldOptions,
        skipDuplicates,
      });
      console.log(`Would import ${plan.createCount}, skip ${plan.skipCount}.`);
      for (const row of plan.rows) {
        if (row.action === "skip") console.log(`  Row ${row.rowNumber}: ${row.reason}`);
      }
      return;
    }

    const summary = importTbillCsv(deps.tbillRepo, fileText, columnMapping, {
      fieldOptions,
      skipDuplicates,
    });
    console.log(`Imported ${summary.importedCount}, skipped ${summary.skippedCount}.`);
    for (const result of summary.results) {
      if (result.status === "skipped") console.log(`  Row ${result.rowNumber}: ${result.reason}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to import T-Bill CSV.");
    process.exitCode = 1;
  }
}
