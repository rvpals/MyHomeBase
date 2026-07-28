import { readFileSync } from "node:fs";
import { parseCsv, listNamedMappings } from "@/lib/csv-import";
import { autoMapJournalHeaders, importJournalCsv } from "@/lib/journal";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

// Thin adapter: read a CSV file, resolve a mapping (a saved named mapping, or an
// auto-map from the file's headers), run the import, and print the summary.
export async function importJournalCsvCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const filePath = flags.file;

  if (!filePath) {
    console.error("Usage: import-journal-csv --file <path> [--mapping <saved-mapping-name>]");
    process.exitCode = 1;
    return;
  }

  try {
    const fileText = readFileSync(filePath, "utf8");

    let columnMapping;
    let fieldOptions;
    if (flags.mapping) {
      const named = listNamedMappings(deps.csvImportMappingRepo, "Journal").find(
        (mapping) => mapping.name === flags.mapping,
      );
      if (!named) {
        console.error(`No saved Journal mapping named "${flags.mapping}".`);
        process.exitCode = 1;
        return;
      }
      columnMapping = named.columnMapping;
      fieldOptions = named.fieldOptions;
    } else {
      ({ columnMapping, fieldOptions } = autoMapJournalHeaders(parseCsv(fileText).headers));
    }

    const summary = importJournalCsv(deps.journalRepo, fileText, columnMapping, fieldOptions);
    console.log(`Imported ${summary.importedCount}, skipped ${summary.skippedCount}.`);
    for (const result of summary.results) {
      if (result.status === "skipped") console.log(`  Row ${result.rowNumber}: ${result.reason}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to import journal CSV.");
    process.exitCode = 1;
  }
}
