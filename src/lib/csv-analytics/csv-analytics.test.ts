import { describe, expect, it } from "vitest";
import type { CsvAnalyticsRepository } from "./ports";
import type { CreateCsvAnalyticEntryInput } from "./schema";
import { buildTableName } from "./sql-builder";
import { createEntry, deleteEntry, listEntries, previewCsvFile, updateEntry } from "./csv-analytics";
import type { CsvAnalyticEntry } from "./types";

function fakeRepo(): CsvAnalyticsRepository {
  let nextId = 1;
  const entries = new Map<number, CsvAnalyticEntry>();
  const stamp = "2026-01-01T00:00:00.000Z";

  function isTaken(tableName: string, excludingId?: number): boolean {
    return [...entries.values()].some((entry) => entry.tableName === tableName && entry.id !== excludingId);
  }

  return {
    listEntries: () => [...entries.values()],
    getEntryById: (id) => entries.get(id),
    isTableNameTaken: (tableName, excludingId) => isTaken(tableName, excludingId),
    createEntry: (input, rows) => {
      const tableName = buildTableName(input.tableBaseName);
      if (isTaken(tableName)) throw new Error(`A CSV analytic entry already uses table name "${tableName}".`);
      const id = nextId++;
      const entry: CsvAnalyticEntry = {
        id,
        name: input.name,
        description: input.description,
        tableName,
        columns: input.columns,
        primaryKeyFields: input.primaryKeyFields,
        rowCount: rows.length,
        createdAt: stamp,
        updatedAt: stamp,
      };
      entries.set(id, entry);
      return entry;
    },
    appendRows: (id, rows) => {
      const entry = entries.get(id);
      if (!entry) throw new Error(`CSV analytic entry ${id} not found.`);
      entries.set(id, { ...entry, rowCount: entry.rowCount + rows.length });
      return { inserted: rows.length, skipped: 0 };
    },
    truncateAndReload: (id, rows) => {
      const entry = entries.get(id);
      if (!entry) throw new Error(`CSV analytic entry ${id} not found.`);
      entries.set(id, { ...entry, rowCount: rows.length });
      return { inserted: rows.length, skipped: 0 };
    },
    overwriteEntry: (id, input, rows) => {
      const entry = entries.get(id);
      if (!entry) throw new Error(`CSV analytic entry ${id} not found.`);
      const updated: CsvAnalyticEntry = {
        ...entry,
        name: input.name,
        description: input.description,
        tableName: buildTableName(input.tableBaseName),
        columns: input.columns,
        primaryKeyFields: input.primaryKeyFields,
        rowCount: rows.length,
      };
      entries.set(id, updated);
      return updated;
    },
    updateMetadata: (id, input) => {
      const entry = entries.get(id);
      if (!entry) throw new Error(`CSV analytic entry ${id} not found.`);
      const updated = { ...entry, name: input.name, description: input.description };
      entries.set(id, updated);
      return updated;
    },
    deleteEntry: (id) => {
      entries.delete(id);
    },
  };
}

const SAMPLE_CSV = "User ID,Event At,Amount\n1,2026-01-01,10.5\n2,2026-01-02,20";

function sampleCreateInput(overrides: Partial<CreateCsvAnalyticEntryInput> = {}): CreateCsvAnalyticEntryInput {
  const preview = previewCsvFile(SAMPLE_CSV);
  return {
    name: "Events",
    description: undefined,
    tableBaseName: "events",
    columns: preview.suggestedColumns,
    primaryKeyFields: ["user_id", "event_at"],
    fileText: SAMPLE_CSV,
    ...overrides,
  };
}

describe("previewCsvFile", () => {
  it("extracts headers, preview rows, and suggested column defs", () => {
    const preview = previewCsvFile(SAMPLE_CSV);
    expect(preview.headers).toEqual(["User ID", "Event At", "Amount"]);
    expect(preview.totalRows).toBe(2);
    expect(preview.suggestedColumns.map((c) => c.name)).toEqual(["user_id", "event_at", "amount"]);
    expect(preview.suggestedColumns.map((c) => c.type)).toEqual(["integer", "date", "real"]);
  });

  it("returns no columns for empty input", () => {
    expect(previewCsvFile("").suggestedColumns).toEqual([]);
  });
});

describe("createEntry", () => {
  it("creates an entry with a csv_-prefixed table name", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, sampleCreateInput());
    expect(entry.tableName).toBe("csv_events");
    expect(entry.rowCount).toBe(2);
    expect(listEntries(repo)).toHaveLength(1);
  });

  it("rejects a primary key field that isn't a defined column", () => {
    const repo = fakeRepo();
    expect(() =>
      createEntry(repo, sampleCreateInput({ primaryKeyFields: ["not_a_column"] })),
    ).toThrow();
  });

  it("rejects an entry with zero columns", () => {
    const repo = fakeRepo();
    expect(() => createEntry(repo, sampleCreateInput({ columns: [] }))).toThrow();
  });
});

describe("updateEntry", () => {
  it("updates name/description without touching the table when no file is given", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, sampleCreateInput());
    const result = updateEntry(repo, entry.id, { name: "Renamed", description: undefined });
    expect(result.entry.name).toBe("Renamed");
    expect(result.entry.rowCount).toBe(2);
    expect(result.ingestResult).toBeUndefined();
  });

  it("appends rows when the new file's headers match the existing schema", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, sampleCreateInput());
    const moreRows = "User ID,Event At,Amount\n3,2026-01-03,5";
    const result = updateEntry(repo, entry.id, {
      name: entry.name,
      description: undefined,
      ingest: { mode: "append", fileText: moreRows },
    });
    expect(result.ingestResult).toEqual({ inserted: 1, skipped: 0 });
    expect(result.entry.rowCount).toBe(3);
  });

  it("rejects append/truncate when the new file's headers don't match the entry's schema", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, sampleCreateInput());
    const mismatched = "Ticker,Price\nAAPL,150";
    expect(() =>
      updateEntry(repo, entry.id, {
        name: entry.name,
        description: undefined,
        ingest: { mode: "append", fileText: mismatched },
      }),
    ).toThrow(/don't match/);
  });

  it("overwrite redefines columns/primary key and reloads from the new file", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, sampleCreateInput());
    const reshaped = "Ticker,Price\nAAPL,150\nMSFT,300";
    const preview = previewCsvFile(reshaped);
    const result = updateEntry(repo, entry.id, {
      name: entry.name,
      description: undefined,
      ingest: {
        mode: "overwrite",
        fileText: reshaped,
        tableBaseName: "prices",
        columns: preview.suggestedColumns,
        primaryKeyFields: ["ticker"],
      },
    });
    expect(result.entry.tableName).toBe("csv_prices");
    expect(result.entry.rowCount).toBe(2);
    expect(result.ingestResult).toBeUndefined();
  });

  it("rejects overwrite with no columns", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, sampleCreateInput());
    expect(() =>
      updateEntry(repo, entry.id, {
        name: entry.name,
        description: undefined,
        ingest: { mode: "overwrite", fileText: "a,b\n1,2", columns: [] },
      }),
    ).toThrow();
  });
});

describe("deleteEntry", () => {
  it("removes the entry", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, sampleCreateInput());
    deleteEntry(repo, entry.id);
    expect(listEntries(repo)).toHaveLength(0);
  });
});
