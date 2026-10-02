import { describe, expect, it } from "vitest";
import { listTableUsage } from "./table-usage";
import type { SqlExplorerRepository } from "./ports";
import type { TableUsageMeasurement } from "./types";

// Only `readTableUsage` matters here, but the use-case takes the whole port —
// so the rest throw. A test that trips one of them has caught the use-case
// reaching for data it has no business reading.
function fakeRepo(measurements: TableUsageMeasurement[]): SqlExplorerRepository {
  const unused = () => {
    throw new Error("not part of listTableUsage");
  };
  return {
    readTableUsage: () => measurements,
    listTables: unused,
    listSchemaObjects: unused,
    readTablePage: unused,
    executeStatement: unused,
    countRows: unused,
    readBlobCell: unused,
    truncateTable: unused,
  };
}

function measurement(
  name: string,
  bytes: number,
  indexBytes = 0,
  rowCount = 0,
): TableUsageMeasurement {
  return { name, bytes, indexBytes, pages: Math.ceil((bytes + indexBytes) / 4096), rowCount };
}

describe("listTableUsage", () => {
  it("ranks tables by table pages plus index pages, largest first", () => {
    const report = listTableUsage(
      fakeRepo([
        measurement("small", 4_096, 0, 3),
        // Smaller table than `medium`, but its indexes make it the bigger
        // consumer — the case that distinguishes totalling from not.
        measurement("heavily_indexed", 8_192, 40_960, 500),
        measurement("medium", 20_480, 0, 90),
      ]),
    );

    expect(report.rows.map((row) => row.name)).toEqual(["heavily_indexed", "medium", "small"]);
    expect(report.rows[0].totalBytes).toBe(49_152);
    expect(report.rows[0].indexBytes).toBe(40_960);
  });

  it("totals every row and reports the largest as the bar maximum", () => {
    const report = listTableUsage(
      fakeRepo([measurement("a", 30_000), measurement("b", 10_000)]),
    );

    expect(report.totalBytes).toBe(40_000);
    expect(report.maxTotalBytes).toBe(30_000);
  });

  it("gives each row its share of the total", () => {
    const report = listTableUsage(
      fakeRepo([measurement("a", 75_000), measurement("b", 25_000)]),
    );

    expect(report.rows[0].percentOfTotal).toBeCloseTo(75);
    expect(report.rows[1].percentOfTotal).toBeCloseTo(25);
  });

  it("carries the row count through untouched", () => {
    const report = listTableUsage(fakeRepo([measurement("a", 4_096, 0, 1_234)]));

    expect(report.rows[0].rowCount).toBe(1_234);
  });

  it("breaks ties on name, so equally-sized tables list predictably", () => {
    const report = listTableUsage(
      fakeRepo([measurement("zebra", 4_096), measurement("apple", 4_096)]),
    );

    expect(report.rows.map((row) => row.name)).toEqual(["apple", "zebra"]);
  });

  it("returns an empty report rather than dividing by zero when nothing was measured", () => {
    const report = listTableUsage(fakeRepo([]));

    expect(report.rows).toEqual([]);
    expect(report.totalBytes).toBe(0);
    expect(report.maxTotalBytes).toBe(0);
  });

  it("reports zero percent rather than NaN when every table measures zero", () => {
    const report = listTableUsage(fakeRepo([measurement("a", 0), measurement("b", 0)]));

    expect(report.rows.every((row) => row.percentOfTotal === 0)).toBe(true);
    expect(report.maxTotalBytes).toBe(0);
  });

  it("propagates a repository failure instead of reporting an empty database", () => {
    const repo = fakeRepo([]);
    repo.readTableUsage = () => {
      throw new Error("no such table: dbstat");
    };

    expect(() => listTableUsage(repo)).toThrow("no such table: dbstat");
  });
});
