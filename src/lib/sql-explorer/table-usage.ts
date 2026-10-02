// Which tables are consuming the database file, ranked.
//
// The repository does the measuring (it is the only thing that may talk to
// SQLite); this ranks what it measured and works out the two derived figures
// the view draws with, so the view itself does no arithmetic.

import type { SqlExplorerRepository } from "./ports";
import type { TableUsageMeasurement, TableUsageReport, TableUsageRow } from "./types";

/**
 * Every table ranked by total size on disk, largest first.
 *
 * "Total" is the table's own pages plus its indexes': the question this answers
 * is "what is filling the file", and an index is as real a consumer as a row.
 * Both numbers survive on the row, so the view can show the split.
 *
 * Ties break on name, so a database where several tables measure identically
 * (a fresh install, where each is one empty page) lists them predictably rather
 * than in whatever order the file walk happened to produce.
 */
export function listTableUsage(repo: SqlExplorerRepository): TableUsageReport {
  const measurements = repo.readTableUsage();

  const rows: TableUsageRow[] = measurements
    .map(toRow)
    .sort((a, b) => b.totalBytes - a.totalBytes || a.name.localeCompare(b.name));

  const totalBytes = rows.reduce((sum, row) => sum + row.totalBytes, 0);

  // Percentages are computed after the total is known, which is why this is a
  // second pass rather than part of `toRow`.
  for (const row of rows) {
    row.percentOfTotal = totalBytes <= 0 ? 0 : (row.totalBytes / totalBytes) * 100;
  }

  return {
    rows,
    totalBytes,
    // The list is sorted, so the biggest is the first — but an empty database
    // has no first row, and a bar needs a non-negative maximum regardless.
    maxTotalBytes: rows.length > 0 ? rows[0].totalBytes : 0,
  };
}

function toRow(measurement: TableUsageMeasurement): TableUsageRow {
  return {
    ...measurement,
    totalBytes: measurement.bytes + measurement.indexBytes,
    // Replaced by the real share once the total is known.
    percentOfTotal: 0,
  };
}
