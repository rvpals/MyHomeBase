// Which tables are consuming the database file, from the terminal.
//
// The CLI peer of SQL Explorer -> Table Usage. Same use-case, same figures, so
// the ranking can be checked without a browser.

import { formatByteSize, listTableUsage } from "@/lib/sql-explorer";
import { deps } from "@/lib/wiring";

const USAGE = `Usage:
  table-usage [--limit <n>]

  --limit   Show only the n largest tables. Defaults to all of them.

Sizes include each table's indexes. Reads SQLite's dbstat, which walks the
whole database file, so this takes a moment on a large database.`;

/** A bar at a fixed width, so the terminal output ranks as visibly as the tab. */
function bar(value: number, max: number, width = 20): string {
  if (max <= 0 || value <= 0) return " ".repeat(width);
  const filled = Math.max(1, Math.round((value / max) * width));
  return "#".repeat(filled).padEnd(width);
}

export async function tableUsageCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(USAGE);
    return;
  }

  const limitIndex = args.indexOf("--limit");
  let limit = Number.POSITIVE_INFINITY;
  if (limitIndex !== -1) {
    const raw = Number(args[limitIndex + 1]);
    if (!Number.isInteger(raw) || raw < 1) {
      console.error("--limit needs a positive whole number.");
      console.error(USAGE);
      process.exitCode = 1;
      return;
    }
    limit = raw;
  }

  const report = listTableUsage(deps.sqlExplorerRepo);
  const rows = report.rows.slice(0, limit === Number.POSITIVE_INFINITY ? undefined : limit);

  if (rows.length === 0) {
    console.log("No tables found.");
    return;
  }

  for (const row of rows) {
    const indexNote = row.indexBytes > 0 ? ` (+${formatByteSize(row.indexBytes)} idx)` : "";
    console.log(
      `  ${row.name.padEnd(32).slice(0, 32)} ` +
        `${bar(row.totalBytes, report.maxTotalBytes)} ` +
        `${formatByteSize(row.totalBytes).padStart(9)} ` +
        `${row.percentOfTotal.toFixed(1).padStart(5)}% ` +
        `${row.rowCount.toLocaleString().padStart(10)} rows` +
        indexNote,
    );
  }

  console.log(
    `\n  ${report.rows.length} table(s), ${formatByteSize(report.totalBytes)} in total.`,
  );
}
