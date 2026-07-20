import { readFileSync } from "node:fs";
import { createEntry, previewCsvFile } from "@/lib/csv-analytics";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

export async function createCsvAnalyticsEntryCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const { name, table: tableBaseName, file: filePath } = flags;

  if (!name || !tableBaseName || !filePath) {
    console.error(
      "Usage: create-csv-analytics-entry --name <name> --table <base-name> --file <path> " +
        "[--primary-key col1,col2] [--description <text>]",
    );
    process.exitCode = 1;
    return;
  }

  try {
    const fileText = readFileSync(filePath, "utf8");
    const preview = previewCsvFile(fileText);
    const primaryKeyFields = flags["primary-key"]
      ? flags["primary-key"].split(",").map((field) => field.trim()).filter(Boolean)
      : [];

    const entry = createEntry(deps.csvAnalyticsRepo, {
      name,
      description: flags.description,
      tableBaseName,
      columns: preview.suggestedColumns,
      primaryKeyFields,
      fileText,
    });
    console.log(`Created entry "${entry.name}" (id ${entry.id}) — table ${entry.tableName}, ${entry.rowCount} rows.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Failed to create entry.");
    process.exitCode = 1;
  }
}
