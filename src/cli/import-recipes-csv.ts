import { readFileSync } from "node:fs";
import { parseCsv, listNamedMappings } from "@/lib/csv-import";
import { autoMapRecipeHeaders, importRecipesCsv } from "@/lib/household";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

// Thin adapter: read a CSV file, resolve a mapping (a saved named mapping, or an
// auto-map from the file's headers), run the import, and print the summary.
// The same use-case the web screen calls, and the same saved mappings — they
// live in `csv_named_mappings` under the "Recipe" import type, so a mapping
// built in the browser is usable here by name. Mirrors import-journal-csv.ts.
export async function importRecipesCsvCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const filePath = flags.file;

  if (!filePath) {
    console.error(
      "Usage: import-recipes-csv --file <path> [--mapping <saved-mapping-name>] "
        + "[--allow-duplicates] [--overwrite]",
    );
    process.exitCode = 1;
    return;
  }

  // Duplicates are skipped unless asked for, matching the import screen's
  // default: re-running the same import should be a no-op.
  const skipDuplicates = !("allow-duplicates" in flags);
  // --overwrite updates a matched recipe in place instead of skipping it, and
  // takes precedence over --allow-duplicates just as the toggle does in the UI.
  // Destructive and unattended here: the web screen confirms against a plan
  // first, a CLI run has already made its choice by typing the flag.
  const overwrite = "overwrite" in flags;

  try {
    const fileText = readFileSync(filePath, "utf8");

    let columnMapping;
    let fieldOptions;
    if (flags.mapping) {
      const named = listNamedMappings(deps.csvImportMappingRepo, "Recipe").find(
        (mapping) => mapping.name === flags.mapping,
      );
      if (!named) {
        console.error(`No saved Recipe mapping named "${flags.mapping}".`);
        process.exitCode = 1;
        return;
      }
      columnMapping = named.columnMapping;
      fieldOptions = named.fieldOptions;
    } else {
      ({ columnMapping, fieldOptions } = autoMapRecipeHeaders(parseCsv(fileText).headers));
    }

    const summary = importRecipesCsv(deps.householdRepo, fileText, columnMapping, fieldOptions, {
      skipDuplicates,
      overwrite,
    });
    console.log(
      `Imported ${summary.importedCount}, updated ${summary.updatedCount}, ` +
        `skipped ${summary.skippedCount}.`,
    );
    for (const result of summary.results) {
      if (result.status === "skipped") console.log(`  Row ${result.rowNumber}: ${result.reason}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to import recipes CSV.");
    process.exitCode = 1;
  }
}
