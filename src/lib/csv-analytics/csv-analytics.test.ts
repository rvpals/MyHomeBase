import { describe, expect, it } from "vitest";
import type { CsvAnalyticsRepository } from "./ports";
import type { CreateCsvAnalyticEntryInput } from "./schema";
import { buildTableName } from "./sql-builder";
import {
  createEntry,
  deleteChartPreset,
  deleteEntry,
  listChartPresets,
  listEntries,
  previewCsvFile,
  readEntryData,
  saveChartPreset,
  updateEntry,
} from "./csv-analytics";
import type { CsvAnalyticEntry, CsvChartPreset } from "./types";

function fakeRepo(): CsvAnalyticsRepository {
  let nextId = 1;
  const entries = new Map<number, CsvAnalyticEntry>();
  // Standalone rows per entry so readTableData has something to return in tests.
  const tableRows = new Map<number, (string | number | null)[][]>();
  const presets = new Map<number, CsvChartPreset>();
  let nextPresetId = 1;
  const stamp = "2026-01-01T00:00:00.000Z";

  function isTaken(tableName: string, excludingId?: number): boolean {
    return [...entries.values()].some((entry) => entry.tableName === tableName && entry.id !== excludingId);
  }

  return {
    listEntries: () => [...entries.values()],
    getEntryById: (id) => entries.get(id),
    isTableNameTaken: (tableName, excludingId) => isTaken(tableName, excludingId),
    readTableData: (id, limit) => {
      const entry = entries.get(id);
      if (!entry) throw new Error(`CSV analytic entry ${id} not found.`);
      const rows = tableRows.get(id) ?? [];
      return { columns: entry.columns, rows: limit !== undefined ? rows.slice(0, limit) : rows };
    },
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
      tableRows.set(id, rows);
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
      for (const [presetId, preset] of presets) {
        if (preset.entryId === id) presets.delete(presetId);
      }
    },
    listChartPresets: (entryId) =>
      [...presets.values()].filter((preset) => preset.entryId === entryId),
    saveChartPreset: (input) => {
      const existing = [...presets.values()].find(
        (preset) => preset.entryId === input.entryId && preset.name === input.name,
      );
      if (existing) {
        const updated = { ...existing, optionsJson: input.optionsJson, updatedAt: stamp };
        presets.set(existing.id, updated);
        return updated;
      }
      const id = nextPresetId++;
      const created: CsvChartPreset = {
        id,
        entryId: input.entryId,
        name: input.name,
        optionsJson: input.optionsJson,
        createdAt: stamp,
        updatedAt: stamp,
      };
      presets.set(id, created);
      return created;
    },
    deleteChartPreset: (id) => {
      presets.delete(id);
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

describe("readEntryData", () => {
  it("returns the entry's columns and row values", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, sampleCreateInput());
    const data = readEntryData(repo, entry.id);
    expect(data.columns.map((column) => column.name)).toEqual(["user_id", "event_at", "amount"]);
    expect(data.rows).toHaveLength(2);
    expect(data.rows[0]).toEqual(["1", "2026-01-01", "10.5"]);
  });

  it("honors a row limit", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, sampleCreateInput());
    expect(readEntryData(repo, entry.id, 1).rows).toHaveLength(1);
  });

  it("throws for an unknown entry", () => {
    const repo = fakeRepo();
    expect(() => readEntryData(repo, 999)).toThrow();
  });
});

describe("deleteEntry", () => {
  it("removes the entry", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, sampleCreateInput());
    deleteEntry(repo, entry.id);
    expect(listEntries(repo)).toHaveLength(0);
  });

  it("also removes the entry's chart presets", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, sampleCreateInput());
    saveChartPreset(repo, { entryId: entry.id, name: "By month", optionsJson: "{}" });
    deleteEntry(repo, entry.id);
    expect(listChartPresets(repo, entry.id)).toHaveLength(0);
  });
});

describe("chart presets", () => {
  it("saves a named preset and lists it back", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, sampleCreateInput());
    const preset = saveChartPreset(repo, {
      entryId: entry.id,
      name: "Amount over time",
      optionsJson: JSON.stringify({ chartType: "line", xKey: "event_at", yKeys: ["amount"] }),
    });
    expect(preset.name).toBe("Amount over time");
    expect(listChartPresets(repo, entry.id)).toHaveLength(1);
  });

  it("overwrites options when saving a repeated name (upsert)", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, sampleCreateInput());
    saveChartPreset(repo, { entryId: entry.id, name: "Chart A", optionsJson: '{"chartType":"line"}' });
    saveChartPreset(repo, { entryId: entry.id, name: "Chart A", optionsJson: '{"chartType":"bar"}' });
    const presets = listChartPresets(repo, entry.id);
    expect(presets).toHaveLength(1);
    expect(presets[0].optionsJson).toBe('{"chartType":"bar"}');
  });

  it("rejects malformed JSON options", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, sampleCreateInput());
    expect(() =>
      saveChartPreset(repo, { entryId: entry.id, name: "Bad", optionsJson: "{not json" }),
    ).toThrow();
  });

  it("deletes a preset by id", () => {
    const repo = fakeRepo();
    const entry = createEntry(repo, sampleCreateInput());
    const preset = saveChartPreset(repo, { entryId: entry.id, name: "Temp", optionsJson: "{}" });
    deleteChartPreset(repo, preset.id);
    expect(listChartPresets(repo, entry.id)).toHaveLength(0);
  });
});
