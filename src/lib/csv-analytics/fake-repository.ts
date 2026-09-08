// An in-memory CsvAnalyticsRepository for the module's unit tests.
//
// Extracted from csv-analytics.test.ts when custom-views.test.ts needed the same
// fake: the port is one interface, so two hand-written copies would drift the moment
// a method was added. Per ARCHITECTURE.md → "Fakes over mocks", this is a real
// implementation rather than a mocking-framework stub.
//
// Not exported from index.ts — it is test support, not part of the module's public
// surface. Tests import it by path, which is the one place that is fine inside a module.
import type { CsvAnalyticsRepository } from "./ports";
import { buildTableName, coerceCellValue } from "./sql-builder";
import {
  compileViewQuery,
  findIncompleteCriteria,
  resolveSelectedColumns,
} from "./view-query";
import type {
  CsvAnalyticEntry,
  CsvChartPreset,
  CsvColumnDefinition,
  CsvCustomView,
  CsvViewPage,
} from "./types";

const STAMP = "2026-01-01T00:00:00.000Z";

export function fakeCsvAnalyticsRepo(): CsvAnalyticsRepository {
  let nextId = 1;
  const entries = new Map<number, CsvAnalyticEntry>();
  // Standalone rows per entry so readTableData has something to return in tests.
  const tableRows = new Map<number, (string | number | null)[][]>();
  // Parallel to tableRows, mirroring the rowid the real table hands back. Assigned
  // from one counter per entry and never reused, so an insert after a bulk edit can't
  // hand back an id the edit just wrote — the same guarantee SQLite's rowid gives.
  const tableRowIds = new Map<number, number[]>();
  const nextRowIdByEntry = new Map<number, number>();

  /** Mints `count` fresh rowids for an entry, continuing where its last insert stopped. */
  function mintRowIds(entryId: number, count: number): number[] {
    let next = nextRowIdByEntry.get(entryId) ?? 1;
    const minted: number[] = [];
    for (let index = 0; index < count; index += 1) minted.push(next++);
    nextRowIdByEntry.set(entryId, next);
    return minted;
  }

  /** Replaces an entry's rows wholesale, minting a fresh rowid for each. */
  function setRows(entryId: number, rows: (string | number | null)[][]): void {
    tableRows.set(entryId, rows);
    tableRowIds.set(entryId, mintRowIds(entryId, rows.length));
  }
  const presets = new Map<number, CsvChartPreset>();
  let nextPresetId = 1;
  const views = new Map<number, CsvCustomView>();
  let nextViewId = 1;

  function isTaken(tableName: string, excludingId?: number): boolean {
    return [...entries.values()].some(
      (entry) => entry.tableName === tableName && entry.id !== excludingId,
    );
  }

  /**
   * Coerces incoming CSV text per column type, exactly as the real repository's
   * `insertRows` does before handing values to SQLite.
   *
   * Not optional detail: storing the raw strings made a view's ORDER BY sort "40"
   * before "90" as text and hand back strings where the real read returns numbers.
   * A fake that skips the write-side conversion is testing a shape production
   * never has.
   */
  function coerceRow(columns: CsvColumnDefinition[], row: string[]): (string | number | null)[] {
    return columns.map((column, index) => coerceCellValue(row[index], column.type));
  }

  /**
   * Applies a view to an entry's in-memory rows.
   *
   * Deliberately NOT a second implementation of the SQL: it calls `compileViewQuery`
   * for the column resolution and to assert the query compiles, then filters in
   * TypeScript. That keeps the fake honest about *which* rows a view selects without
   * pretending to be SQLite — the real SQL is covered directly in view-query.test.ts.
   */
  function applyView(view: CsvCustomView, page: number): CsvViewPage {
    const entry = entries.get(view.entryId);
    if (!entry) throw new Error(`CSV analytic entry ${view.entryId} not found.`);

    const compiled = compileViewQuery({
      tableName: entry.tableName,
      entryColumns: entry.columns,
      selectedColumns: view.selectedColumns,
      criteria: view.criteria,
      orderBy: view.orderBy,
      recordsPerPage: view.recordsPerPage,
      page,
    });

    const allRows = tableRows.get(view.entryId) ?? [];
    const indexOf = (name: string) => entry.columns.findIndex((column) => column.name === name);

    // Only the criteria the compiler would actually emit — an incomplete one is
    // skipped there, so skipping it here keeps the two in step.
    const incomplete = new Set(findIncompleteCriteria(view.criteria));
    const activeCriteria = view.criteria.filter(
      (criterion) => !incomplete.has(criterion) && indexOf(criterion.column) >= 0,
    );

    const matching = allRows.filter((row) =>
      activeCriteria.every((criterion) => {
        const cell = row[indexOf(criterion.column)];
        const text = cell === null || cell === undefined ? "" : String(cell);
        const values = criterion.values.map((value) => value.trim()).filter((value) => value !== "");
        const asNumber = Number(text);
        const bound = Number(values[0]);
        const numeric = Number.isFinite(asNumber) && Number.isFinite(bound);

        switch (criterion.operator) {
          case "equals":
            return text === values[0];
          case "notEquals":
            return text !== values[0];
          case "greaterThan":
            return numeric ? asNumber > bound : text > values[0];
          case "greaterThanOrEqual":
            return numeric ? asNumber >= bound : text >= values[0];
          case "lessThan":
            return numeric ? asNumber < bound : text < values[0];
          case "lessThanOrEqual":
            return numeric ? asNumber <= bound : text <= values[0];
          case "contains":
            return text.includes(values[0]);
          case "notContains":
            return !text.includes(values[0]);
          case "startsWith":
            return text.startsWith(values[0]);
          case "endsWith":
            return text.endsWith(values[0]);
          case "between": {
            const upper = Number(values[1]);
            return Number.isFinite(asNumber) && Number.isFinite(bound) && Number.isFinite(upper)
              ? asNumber >= bound && asNumber <= upper
              : text >= values[0] && text <= values[1];
          }
          case "isEmpty":
            return text === "";
          case "isNotEmpty":
            return text !== "";
          case "in":
            return values.includes(text);
          case "notIn":
            return !values.includes(text);
        }
      }),
    );

    const sorted = [...matching];
    // Applied last-key-first so the first order-by ends up the primary sort, which is
    // what a stable sort gives us and what ORDER BY a, b means.
    for (const order of [...view.orderBy].reverse()) {
      const index = indexOf(order.column);
      if (index < 0) continue;
      sorted.sort((left, right) => {
        const a = left[index];
        const b = right[index];
        if (a === b) return 0;
        if (a === null || a === undefined) return order.direction === "asc" ? -1 : 1;
        if (b === null || b === undefined) return order.direction === "asc" ? 1 : -1;
        const comparison = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
        return order.direction === "asc" ? comparison : -comparison;
      });
    }

    const recordsPerPage = Math.max(1, Math.floor(view.recordsPerPage));
    const start = (Math.max(1, Math.floor(page)) - 1) * recordsPerPage;
    const selected = resolveSelectedColumns(entry.columns, view.selectedColumns);
    const projected = sorted
      .slice(start, start + recordsPerPage)
      .map((row) => selected.map((column) => row[indexOf(column.name)] ?? null));

    return {
      columns: compiled.columns,
      rows: projected,
      totalRows: sorted.length,
      page: Math.max(1, Math.floor(page)),
      pageCount: Math.max(1, Math.ceil(sorted.length / recordsPerPage)),
      recordsPerPage,
    };
  }

  return {
    listEntries: () => [...entries.values()],
    getEntryById: (id) => entries.get(id),
    isTableNameTaken: (tableName, excludingId) => isTaken(tableName, excludingId),
    readTableData: (id, limit) => {
      const entry = entries.get(id);
      if (!entry) throw new Error(`CSV analytic entry ${id} not found.`);
      const rows = tableRows.get(id) ?? [];
      const rowIds = tableRowIds.get(id) ?? [];
      const capped = limit !== undefined && limit > 0;
      return {
        columns: entry.columns,
        rows: capped ? rows.slice(0, limit) : rows,
        rowIds: capped ? rowIds.slice(0, limit) : rowIds,
      };
    },
    bulkUpdateRows: (entryId, chunks, fields, values) => {
      const entry = entries.get(entryId);
      if (!entry) throw new Error(`CSV analytic entry ${entryId} not found.`);
      const rows = tableRows.get(entryId) ?? [];
      const rowIds = tableRowIds.get(entryId) ?? [];

      // Index of each field in the entry's column order — the same positional
      // mapping the row arrays use everywhere else in this module.
      const indexByName = new Map(entry.columns.map((column, index) => [column.name, index]));

      const targets = new Set(chunks.flat());
      let updated = 0;
      rowIds.forEach((rowId, rowIndex) => {
        if (!targets.has(rowId)) return;
        const row = [...rows[rowIndex]];
        for (const field of fields) {
          const columnIndex = indexByName.get(field);
          if (columnIndex === undefined) continue;
          row[columnIndex] = values[field] ?? null;
        }
        rows[rowIndex] = row;
        updated += 1;
      });
      tableRows.set(entryId, rows);
      return updated;
    },
    createEntry: (input, rows) => {
      const tableName = buildTableName(input.tableBaseName);
      if (isTaken(tableName)) {
        throw new Error(`A CSV analytic entry already uses table name "${tableName}".`);
      }
      const id = nextId++;
      const entry: CsvAnalyticEntry = {
        id,
        name: input.name,
        description: input.description,
        tableName,
        columns: input.columns,
        primaryKeyFields: input.primaryKeyFields,
        rowCount: rows.length,
        createdAt: STAMP,
        updatedAt: STAMP,
      };
      entries.set(id, entry);
      setRows(id, rows.map((row) => coerceRow(input.columns, row)));
      return entry;
    },
    appendRows: (id, rows) => {
      const entry = entries.get(id);
      if (!entry) throw new Error(`CSV analytic entry ${id} not found.`);
      entries.set(id, { ...entry, rowCount: entry.rowCount + rows.length });
      const appended = rows.map((row) => coerceRow(entry.columns, row));
      tableRows.set(id, [...(tableRows.get(id) ?? []), ...appended]);
      tableRowIds.set(id, [...(tableRowIds.get(id) ?? []), ...mintRowIds(id, appended.length)]);
      return { inserted: rows.length, skipped: 0 };
    },
    truncateAndReload: (id, rows) => {
      const entry = entries.get(id);
      if (!entry) throw new Error(`CSV analytic entry ${id} not found.`);
      entries.set(id, { ...entry, rowCount: rows.length });
      setRows(id, rows.map((row) => coerceRow(entry.columns, row)));
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
      setRows(id, rows.map((row) => coerceRow(input.columns, row)));
      return updated;
    },
    updateMetadata: (id, input) => {
      const entry = entries.get(id);
      if (!entry) throw new Error(`CSV analytic entry ${id} not found.`);
      const updated = { ...entry, name: input.name, description: input.description };
      entries.set(id, updated);
      return updated;
    },
    addColumns: (id, newColumns) => {
      const entry = entries.get(id);
      if (!entry) throw new Error(`CSV analytic entry ${id} not found.`);
      const updated = { ...entry, columns: [...entry.columns, ...newColumns] };
      entries.set(id, updated);
      // Existing rows get NULL for each new column — no backfill.
      const rows = tableRows.get(id) ?? [];
      tableRows.set(
        id,
        rows.map((row) => [...row, ...newColumns.map(() => null)]),
      );
      return updated;
    },
    deleteEntry: (id) => {
      entries.delete(id);
      // The real repository drops the physical table; here that is the row storage.
      tableRows.delete(id);
      tableRowIds.delete(id);
      nextRowIdByEntry.delete(id);
      for (const [presetId, preset] of presets) {
        if (preset.entryId === id) presets.delete(presetId);
      }
      // Mirrors the real repository: an entry's views go with it.
      for (const [viewId, view] of views) {
        if (view.entryId === id) views.delete(viewId);
      }
    },
    listChartPresets: (entryId) =>
      [...presets.values()].filter((preset) => preset.entryId === entryId),
    saveChartPreset: (input) => {
      const existing = [...presets.values()].find(
        (preset) => preset.entryId === input.entryId && preset.name === input.name,
      );
      if (existing) {
        const updated = { ...existing, optionsJson: input.optionsJson, updatedAt: STAMP };
        presets.set(existing.id, updated);
        return updated;
      }
      const id = nextPresetId++;
      const created: CsvChartPreset = {
        id,
        entryId: input.entryId,
        name: input.name,
        optionsJson: input.optionsJson,
        createdAt: STAMP,
        updatedAt: STAMP,
      };
      presets.set(id, created);
      return created;
    },
    deleteChartPreset: (id) => {
      presets.delete(id);
    },

    listCustomViews: (entryId) => [...views.values()].filter((view) => view.entryId === entryId),
    listAllCustomViews: () => [...views.values()],
    getCustomViewById: (id) => views.get(id),
    isCustomViewNameTaken: (entryId, name, excludingId) =>
      [...views.values()].some(
        (view) => view.entryId === entryId && view.name === name && view.id !== excludingId,
      ),
    createCustomView: (input) => {
      const id = nextViewId++;
      const created: CsvCustomView = {
        id,
        entryId: input.entryId,
        name: input.name,
        description: input.description,
        selectedColumns: input.selectedColumns,
        criteria: input.criteria,
        orderBy: input.orderBy,
        recordsPerPage: input.recordsPerPage,
        isEnabled: input.isEnabled,
        createdAt: STAMP,
        updatedAt: STAMP,
      };
      views.set(id, created);
      return created;
    },
    updateCustomView: (id, input) => {
      const existing = views.get(id);
      if (!existing) throw new Error(`Custom view ${id} not found.`);
      const updated: CsvCustomView = {
        ...existing,
        name: input.name,
        description: input.description,
        selectedColumns: input.selectedColumns,
        criteria: input.criteria,
        orderBy: input.orderBy,
        recordsPerPage: input.recordsPerPage,
        isEnabled: input.isEnabled,
        updatedAt: STAMP,
      };
      views.set(id, updated);
      return updated;
    },
    setCustomViewEnabled: (id, isEnabled) => {
      const existing = views.get(id);
      if (!existing) throw new Error(`Custom view ${id} not found.`);
      const updated = { ...existing, isEnabled, updatedAt: STAMP };
      views.set(id, updated);
      return updated;
    },
    deleteCustomView: (id) => {
      views.delete(id);
    },
    readCustomViewPage: (view, page) => applyView(view, page),
  };
}

/** A column definition, for tests that build an entry schema by hand. */
export function fakeColumn(
  name: string,
  type: CsvColumnDefinition["type"] = "text",
): CsvColumnDefinition {
  return { name, sourceHeader: name, type };
}
