import { deleteEntry, getEntryById } from "@/lib/csv-analytics";
import { deps } from "@/lib/wiring";

export async function deleteCsvAnalyticsEntryCommand(args: string[]): Promise<void> {
  const id = Number(args[0]);

  if (!Number.isInteger(id) || id <= 0) {
    console.error("Usage: delete-csv-analytics-entry <id>");
    process.exitCode = 1;
    return;
  }

  const entry = getEntryById(deps.csvAnalyticsRepo, id);
  if (!entry) {
    console.error(`No CSV analytic entry with id ${id}.`);
    process.exitCode = 1;
    return;
  }

  deleteEntry(deps.csvAnalyticsRepo, id);
  console.log(`Deleted entry "${entry.name}" (id ${id}) and dropped table ${entry.tableName}.`);
}
