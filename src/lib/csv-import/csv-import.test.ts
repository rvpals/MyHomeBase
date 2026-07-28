import { describe, expect, it } from "vitest";
import {
  createNamedMapping,
  deleteNamedMapping,
  getCurrentMapping,
  listNamedMappings,
  previewCsv,
  saveCurrentMapping,
  updateNamedMapping,
} from "./csv-import";
import type { CsvImportMappingRepository } from "./ports";
import type { ColumnMapping, ImportType, NamedMapping } from "./types";

// Hand-written fake — no mocking framework, reusable across tests.
function fakeRepo(seedNamed: NamedMapping[] = []): CsvImportMappingRepository {
  const current = new Map<ImportType, ColumnMapping>();
  let named = [...seedNamed];
  let nextId = named.reduce((max, mapping) => Math.max(max, mapping.id), 0) + 1;

  return {
    getCurrentMapping: (importType) => current.get(importType),
    saveCurrentMapping: (importType, columnMapping) => {
      current.set(importType, columnMapping);
    },
    listNamedMappings: (importType) => named.filter((mapping) => mapping.importType === importType),
    getNamedMappingById: (id) => named.find((mapping) => mapping.id === id),
    createNamedMapping: (input) => {
      const created: NamedMapping = {
        id: nextId++,
        ...input,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };
      named.push(created);
      return created;
    },
    updateNamedMapping: (id, input) => {
      named = named.map((mapping) => (mapping.id === id ? { ...mapping, ...input } : mapping));
      const updated = named.find((mapping) => mapping.id === id);
      if (!updated) throw new Error(`Named mapping ${id} not found.`);
      return updated;
    },
    deleteNamedMapping: (id) => {
      named = named.filter((mapping) => mapping.id !== id);
    },
  };
}

describe("previewCsv", () => {
  it("parses headers, previews the first rows, and auto-maps columns", () => {
    const preview = previewCsv("Symbol,Price\nAAPL,150.00\nMSFT,300.00");
    expect(preview.headers).toEqual(["Symbol", "Price"]);
    expect(preview.totalRows).toBe(2);
    expect(preview.autoMapping).toEqual({ "0": "ticker", "1": "currentPrice" });
  });
});

describe("current mapping", () => {
  it("saves and retrieves the current mapping for an import type", () => {
    const repo = fakeRepo();
    saveCurrentMapping(repo, { importType: "Position", columnMapping: { "0": "ticker" } });
    expect(getCurrentMapping(repo, "Position")).toEqual({ "0": "ticker" });
  });

  it("returns undefined when no mapping has been saved for that type", () => {
    expect(getCurrentMapping(fakeRepo(), "Transaction")).toBeUndefined();
  });
});

describe("named mappings", () => {
  it("creates and lists named mappings scoped to their import type", () => {
    const repo = fakeRepo();
    createNamedMapping(repo, { name: "My Broker Export", importType: "Position", columnMapping: { "0": "ticker" } });
    createNamedMapping(repo, { name: "Other Type", importType: "Transaction", columnMapping: { "0": "date" } });

    expect(listNamedMappings(repo, "Position")).toHaveLength(1);
    expect(listNamedMappings(repo, "Position")[0].name).toBe("My Broker Export");
  });

  it("rejects an empty name", () => {
    const repo = fakeRepo();
    expect(() =>
      createNamedMapping(repo, { name: "", importType: "Position", columnMapping: {} }),
    ).toThrow();
  });

  it("deletes a named mapping", () => {
    const repo = fakeRepo();
    const created = createNamedMapping(repo, { name: "Temp", importType: "Position", columnMapping: {} });
    deleteNamedMapping(repo, created.id);
    expect(listNamedMappings(repo, "Position")).toHaveLength(0);
  });

  it("updates a named mapping's name, columns, and options", () => {
    const repo = fakeRepo();
    const created = createNamedMapping(repo, {
      name: "Journal v1",
      importType: "Journal",
      columnMapping: { "0": "date" },
    });
    const updated = updateNamedMapping(repo, created.id, {
      name: "Journal v2",
      columnMapping: { "0": "date", "1": "title" },
      fieldOptions: { "0": { dateFormat: "M/D/YY" } },
    });
    expect(updated.name).toBe("Journal v2");
    expect(updated.columnMapping).toEqual({ "0": "date", "1": "title" });
    expect(updated.fieldOptions).toEqual({ "0": { dateFormat: "M/D/YY" } });
  });

  it("rejects updating a non-existent mapping", () => {
    expect(() =>
      updateNamedMapping(fakeRepo(), 999, { name: "x", columnMapping: {} }),
    ).toThrow();
  });
});
