import { listEntries } from "@/lib/csv-analytics";
import { deps } from "@/lib/wiring";

export async function listCsvAnalyticsCommand(): Promise<void> {
  const entries = listEntries(deps.csvAnalyticsRepo);

  if (entries.length === 0) {
    console.log("No CSV analytic entries yet.");
    return;
  }

  for (const entry of entries) {
    const pk = entry.primaryKeyFields.length ? `, primary key (${entry.primaryKeyFields.join(", ")})` : "";
    console.log(
      `#${entry.id} ${entry.name} — table ${entry.tableName}, ${entry.columns.length} columns, ${entry.rowCount} rows${pk}`,
    );
  }
}
