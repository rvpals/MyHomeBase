// Per-source statistics over a pooled CSV dataset, from the terminal.
//
// The CLI peer of CSV Analysis -> Compare. Prints the same figures the screen shows,
// from the same use-case, which is how the arithmetic is checked without a browser.

import {
  groupableSourceColumns,
  measurableColumns,
  readSourceStats,
  type SourceStats,
} from "@/lib/csv-analytics";
import { deps } from "@/lib/wiring";

const USAGE = `Usage:
  csv-source-stats <entry-id> [--by <column>] [--measure <column>] [--decimals <n>]

  --by        Which source column to group by. Defaults to the first one.
  --measure   Which numeric column to summarise. Defaults to the first one.

Run with just an entry id to see the columns available.`;

function format(value: number | null, decimals: number): string {
  return value === null ? "—" : value.toFixed(decimals);
}

function printRow(stats: SourceStats, decimals: number): void {
  const label = (stats.source ?? "ALL").padEnd(24).slice(0, 24);
  console.log(
    `  ${label} n=${String(stats.rowCount).padStart(6)}  ` +
      `avg=${format(stats.mean, decimals).padStart(9)}  ` +
      `med=${format(stats.median, decimals).padStart(9)}  ` +
      `min=${format(stats.min, decimals).padStart(9)}  ` +
      `max=${format(stats.max, decimals).padStart(9)}  ` +
      `sd=${format(stats.stdDev, decimals).padStart(9)}  ` +
      `missing=${stats.nullCount}`,
  );
}

export async function csvSourceStatsCommand(args: string[]): Promise<void> {
  const [idArg, ...rest] = args;
  if (!idArg || idArg === "help") {
    console.log(USAGE);
    return;
  }

  const entryId = Number(idArg);
  if (Number.isNaN(entryId)) {
    console.error(`"${idArg}" is not an entry id.\n`);
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  let groupColumn: string | undefined;
  let measureColumn: string | undefined;
  let decimals = 2;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--by") groupColumn = rest[++i];
    else if (rest[i] === "--measure") measureColumn = rest[++i];
    else if (rest[i] === "--decimals") decimals = Number(rest[++i]);
  }

  const entry = deps.csvAnalyticsRepo.getEntryById(entryId);
  if (!entry) {
    console.error(`No CSV analytic entry #${entryId}.`);
    process.exitCode = 1;
    return;
  }
  if (entry.sourceColumns.length === 0) {
    console.error(
      `"${entry.name}" was not created as a pooled import, so it has no source column ` +
        `to group by. Import several files at once to create one.`,
    );
    process.exitCode = 1;
    return;
  }

  const groups = groupableSourceColumns(entry.sourceColumns, entry.columns);
  const measures = measurableColumns(entry.columns);

  if (groups.length === 0 || measures.length === 0) {
    console.error("This dataset has no source column, or no numeric column to summarise.");
    process.exitCode = 1;
    return;
  }

  const by = groupColumn ?? groups[0].name;
  const measure = measureColumn ?? measures[0].name;

  console.log(`"${entry.name}" — grouped by ${by}, measuring ${measure}`);
  console.log(`  (group by: ${groups.map((column) => column.name).join(", ")})`);
  console.log(`  (measures: ${measures.map((column) => column.name).join(", ")})\n`);

  const stats = readSourceStats(deps.csvAnalyticsRepo, {
    entryId,
    groupColumn: by,
    measureColumn: measure,
  });

  stats.perSource.forEach((row) => printRow(row, decimals));
  console.log("");
  printRow(stats.combined, decimals);

  if (stats.highest && stats.lowest) {
    console.log(
      `\nHighest: ${stats.highest.source} (${format(stats.highest.mean, decimals)}), ` +
        `lowest: ${stats.lowest.source} (${format(stats.lowest.mean, decimals)}).`,
    );
  }
}
