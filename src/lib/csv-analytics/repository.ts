import type Database from "better-sqlite3";
import type { CsvAnalyticsRepository } from "./ports";
import type {
  CreateCsvAnalyticEntryInput,
  CreateCsvCustomViewInput,
  SaveChartPresetInput,
  UpdateCsvCustomViewInput,
} from "./schema";
import {
  buildAddColumnSql,
  buildBulkUpdateSql,
  buildCreateTableSql,
  buildDropTableSql,
  buildInsertSql,
  buildSelectRowsSql,
  buildTableName,
  coerceCellValue,
  quoteIdentifier,
} from "./sql-builder";
import { sourceColumnDefinitions } from "./multi-import";
import type {
  CsvAnalyticEntry,
  CsvChartPreset,
  CsvColumnDefinition,
  CsvCustomView,
  CsvEntryData,
  CsvSourceColumn,
  CsvViewCriterion,
  CsvViewOrderBy,
  CsvViewPage,
  IngestResult,
} from "./types";
import { compileViewQuery } from "./view-query";

interface CsvChartPresetRow {
  id: number;
  entry_id: number;
  name: string;
  options_json: string;
  created_at: string;
  updated_at: string;
}

interface CsvCustomViewRow {
  id: number;
  entry_id: number;
  name: string;
  description: string | null;
  selected_columns_json: string;
  criteria_json: string;
  order_by_json: string;
  records_per_page: number;
  is_enabled: number;
  created_at: string;
  updated_at: string;
}

interface CsvAnalyticsEntryRow {
  id: number;
  name: string;
  description: string | null;
  table_name: string;
  columns_json: string;
  primary_key_fields_json: string;
  /** Migration 0104. NULL for every entry that predates pooled imports. */
  source_columns_json: string | null;
  created_at: string;
  updated_at: string;
}

// The real repository. Owns both the metadata table (a normal migrated table) and each
// entry's dynamically created/dropped physical data table — the only domain in this app
// where a use-case's data lives outside a static migration.
export class SqliteCsvAnalyticsRepository implements CsvAnalyticsRepository {
  constructor(private db: Database.Database) {}

  private countRows(tableName: string): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`).get() as {
      count: number;
    };
    return row.count;
  }

  private toDomain(row: CsvAnalyticsEntryRow): CsvAnalyticEntry {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      tableName: row.table_name,
      columns: JSON.parse(row.columns_json) as CsvColumnDefinition[],
      primaryKeyFields: JSON.parse(row.primary_key_fields_json) as string[],
      // NULL (pre-0104, or any single-file import) reads as "not a pooled dataset".
      sourceColumns: row.source_columns_json
        ? (JSON.parse(row.source_columns_json) as CsvSourceColumn[])
        : [],
      rowCount: this.countRows(row.table_name),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private getRowById(id: number): CsvAnalyticsEntryRow | undefined {
    return this.db.prepare("SELECT * FROM csv_analytics_entries WHERE id = ?").get(id) as
      | CsvAnalyticsEntryRow
      | undefined;
  }

  listEntries(): CsvAnalyticEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM csv_analytics_entries ORDER BY created_at ASC")
      .all() as CsvAnalyticsEntryRow[];
    return rows.map((row) => this.toDomain(row));
  }

  getEntryById(id: number): CsvAnalyticEntry | undefined {
    const row = this.getRowById(id);
    return row ? this.toDomain(row) : undefined;
  }

  isTableNameTaken(tableName: string, excludingId?: number): boolean {
    const row = this.db
      .prepare("SELECT id FROM csv_analytics_entries WHERE table_name = ? AND id != ?")
      .get(tableName, excludingId ?? -1) as { id: number } | undefined;
    return row !== undefined;
  }

  readTableData(id: number, limit?: number): CsvEntryData {
    const row = this.getRowById(id);
    if (!row) throw new Error(`CSV analytic entry ${id} not found.`);
    const columns = JSON.parse(row.columns_json) as CsvColumnDefinition[];

    // Select columns explicitly in definition order (skips the surrogate _row_id key)
    // so returned row arrays line up 1:1 with `columns`, plus `rowid` appended last.
    // The rowid is what makes a row addressable for a bulk edit; it is split off here
    // rather than left in the array so `rows` keeps exactly the shape it always had.
    const raw = this.db
      .prepare(buildSelectRowsSql(row.table_name, columns, limit))
      .raw()
      .all() as (string | number | null)[][];

    const rows: (string | number | null)[][] = [];
    const rowIds: number[] = [];
    for (const values of raw) {
      rows.push(values.slice(0, columns.length));
      rowIds.push(Number(values[columns.length]));
    }

    return { columns, rows, rowIds };
  }

  bulkUpdateRows(
    entryId: number,
    chunks: number[][],
    fields: string[],
    values: Record<string, string | number | null>,
  ): number {
    const row = this.getRowById(entryId);
    if (!row) throw new Error(`CSV analytic entry ${entryId} not found.`);

    // One transaction across every chunk: the chunking exists only to stay under
    // SQLite's host-parameter ceiling, so a selection split into four UPDATEs must
    // still land all-or-nothing.
    const run = this.db.transaction(() => {
      let updated = 0;
      for (const chunk of chunks) {
        if (chunk.length === 0) continue;
        const statement = this.db.prepare(buildBulkUpdateSql(row.table_name, fields, chunk.length));
        // Named params for the field values, positional for the rowids — the order
        // buildBulkUpdateSql lays them out in.
        const result = statement.run(values, ...chunk);
        updated += result.changes;
      }
      return updated;
    });

    return run();
  }

  /** Inserts every row, coercing each cell per its column's type. Returns rows actually written. */
  private insertRows(
    tableName: string,
    columns: CsvColumnDefinition[],
    rows: string[][],
    orIgnore: boolean,
  ): number {
    const insert = this.db.prepare(buildInsertSql(tableName, columns, orIgnore));
    let inserted = 0;
    for (const row of rows) {
      const params: Record<string, string | number | null> = {};
      columns.forEach((column, index) => {
        params[column.name] = coerceCellValue(row[index], column.type);
      });
      inserted += insert.run(params).changes;
    }
    return inserted;
  }

  createEntry(input: CreateCsvAnalyticEntryInput, rows: string[][]): CsvAnalyticEntry {
    const tableName = buildTableName(input.tableBaseName);
    if (this.isTableNameTaken(tableName)) {
      throw new Error(`A CSV analytic entry already uses table name "${tableName}".`);
    }
    const createTableSql = buildCreateTableSql(tableName, input.columns, input.primaryKeyFields);

    // Duplicate primary-key values within a brand-new file fail loudly here (a plain
    // INSERT, not OR IGNORE) — on first definition, a PK collision means the chosen
    // primary key is wrong, which is worth surfacing rather than silently dropping rows.
    const run = this.db.transaction(() => {
      this.db.exec(createTableSql);
      this.insertRows(tableName, input.columns, rows, false);
      const result = this.db
        .prepare(
          `INSERT INTO csv_analytics_entries (name, description, table_name, columns_json, primary_key_fields_json)
           VALUES (@name, @description, @tableName, @columnsJson, @primaryKeyFieldsJson)`,
        )
        .run({
          name: input.name,
          description: input.description ?? null,
          tableName,
          columnsJson: JSON.stringify(input.columns),
          primaryKeyFieldsJson: JSON.stringify(input.primaryKeyFields),
        });
      return Number(result.lastInsertRowid);
    });

    const created = this.getEntryById(run());
    if (!created) throw new Error("Failed to read back newly created CSV analytic entry.");
    return created;
  }

  createPooledEntry(
    input: { name: string; description?: string; tableBaseName: string },
    columns: CsvColumnDefinition[],
    sourceColumns: CsvSourceColumn[],
    rows: string[][],
  ): CsvAnalyticEntry {
    const tableName = buildTableName(input.tableBaseName);
    if (this.isTableNameTaken(tableName)) {
      throw new Error(`A CSV analytic entry already uses table name "${tableName}".`);
    }

    // A pooled table takes the surrogate `_row_id` key (no primaryKeyFields): several
    // devices legitimately report the same timestamp, so any PK over the data columns
    // would make one device's readings collide with another's.
    const allColumns = [...columns, ...sourceColumnDefinitions(sourceColumns)];
    const createTableSql = buildCreateTableSql(tableName, allColumns, []);

    const run = this.db.transaction(() => {
      this.db.exec(createTableSql);
      this.insertRows(tableName, allColumns, rows, false);
      const result = this.db
        .prepare(
          `INSERT INTO csv_analytics_entries
             (name, description, table_name, columns_json, primary_key_fields_json, source_columns_json)
           VALUES (@name, @description, @tableName, @columnsJson, @primaryKeyFieldsJson, @sourceColumnsJson)`,
        )
        .run({
          name: input.name,
          description: input.description ?? null,
          tableName,
          columnsJson: JSON.stringify(allColumns),
          primaryKeyFieldsJson: JSON.stringify([]),
          sourceColumnsJson: JSON.stringify(sourceColumns),
        });
      return Number(result.lastInsertRowid);
    });

    const created = this.getEntryById(run());
    if (!created) throw new Error("Failed to read back newly created pooled CSV entry.");
    return created;
  }

  appendPooledRows(id: number, rows: string[][]): IngestResult {
    const row = this.getRowById(id);
    if (!row) throw new Error(`CSV analytic entry ${id} not found.`);
    const columns = JSON.parse(row.columns_json) as CsvColumnDefinition[];

    // `false` — a plain INSERT, deliberately unlike `appendRows`. OR IGNORE would turn
    // a second device reporting the same timestamp into a silently skipped row, which
    // is exactly the data loss pooling exists to avoid.
    const before = this.countRows(row.table_name);
    this.db.transaction(() => this.insertRows(row.table_name, columns, rows, false))();
    const inserted = this.countRows(row.table_name) - before;
    return { inserted, skipped: rows.length - inserted };
  }

  listSourceValues(id: number, columnName: string): string[] {
    const row = this.getRowById(id);
    if (!row) throw new Error(`CSV analytic entry ${id} not found.`);

    // The identifier is validated against the entry's real column list before being
    // interpolated, and still quoted — the same two rules as sql-builder.ts.
    const columns = JSON.parse(row.columns_json) as CsvColumnDefinition[];
    if (!columns.some((column) => column.name === columnName)) {
      throw new Error(`Unknown column "${columnName}" on entry ${id}.`);
    }

    const results = this.db
      .prepare(
        `SELECT DISTINCT ${quoteIdentifier(columnName)} AS value
           FROM ${quoteIdentifier(row.table_name)}
          WHERE ${quoteIdentifier(columnName)} IS NOT NULL
          ORDER BY value`,
      )
      .all() as { value: string | number | null }[];

    return results.map((result) => String(result.value));
  }

  appendRows(id: number, rows: string[][]): IngestResult {
    const row = this.getRowById(id);
    if (!row) throw new Error(`CSV analytic entry ${id} not found.`);
    const columns = JSON.parse(row.columns_json) as CsvColumnDefinition[];

    const before = this.countRows(row.table_name);
    this.db.transaction(() => this.insertRows(row.table_name, columns, rows, true))();
    const inserted = this.countRows(row.table_name) - before;
    return { inserted, skipped: rows.length - inserted };
  }

  truncateAndReload(id: number, rows: string[][]): IngestResult {
    const row = this.getRowById(id);
    if (!row) throw new Error(`CSV analytic entry ${id} not found.`);
    const columns = JSON.parse(row.columns_json) as CsvColumnDefinition[];

    const inserted = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM ${quoteIdentifier(row.table_name)}`).run();
      return this.insertRows(row.table_name, columns, rows, true);
    })();
    return { inserted, skipped: rows.length - inserted };
  }

  addColumns(id: number, newColumns: CsvColumnDefinition[]): CsvAnalyticEntry {
    const row = this.getRowById(id);
    if (!row) throw new Error(`CSV analytic entry ${id} not found.`);
    const columns = JSON.parse(row.columns_json) as CsvColumnDefinition[];
    const mergedColumns = [...columns, ...newColumns];

    this.db.transaction(() => {
      for (const column of newColumns) {
        this.db.exec(buildAddColumnSql(row.table_name, column));
      }
      this.db
        .prepare(`UPDATE csv_analytics_entries SET columns_json = @columnsJson WHERE id = @id`)
        .run({ id, columnsJson: JSON.stringify(mergedColumns) });
    })();

    const updated = this.getEntryById(id);
    if (!updated) throw new Error(`Failed to read back CSV analytic entry ${id} after adding columns.`);
    return updated;
  }

  overwriteEntry(id: number, input: CreateCsvAnalyticEntryInput, rows: string[][]): CsvAnalyticEntry {
    const existing = this.getRowById(id);
    if (!existing) throw new Error(`CSV analytic entry ${id} not found.`);

    const tableName = buildTableName(input.tableBaseName);
    if (tableName !== existing.table_name && this.isTableNameTaken(tableName, id)) {
      throw new Error(`A CSV analytic entry already uses table name "${tableName}".`);
    }
    const createTableSql = buildCreateTableSql(tableName, input.columns, input.primaryKeyFields);

    this.db.transaction(() => {
      this.db.exec(buildDropTableSql(existing.table_name));
      this.db.exec(createTableSql);
      this.insertRows(tableName, input.columns, rows, false);
      this.db
        .prepare(
          `UPDATE csv_analytics_entries
           SET name = @name, description = @description, table_name = @tableName,
               columns_json = @columnsJson, primary_key_fields_json = @primaryKeyFieldsJson,
               -- Overwrite redefines the whole schema from one dropped file, so any
               -- pooled source columns would now name columns that no longer exist.
               source_columns_json = NULL
           WHERE id = @id`,
        )
        .run({
          id,
          name: input.name,
          description: input.description ?? null,
          tableName,
          columnsJson: JSON.stringify(input.columns),
          primaryKeyFieldsJson: JSON.stringify(input.primaryKeyFields),
        });
    })();

    const updated = this.getEntryById(id);
    if (!updated) throw new Error(`Failed to read back overwritten CSV analytic entry ${id}.`);
    return updated;
  }

  updateMetadata(id: number, input: { name: string; description?: string }): CsvAnalyticEntry {
    this.db
      .prepare("UPDATE csv_analytics_entries SET name = @name, description = @description WHERE id = @id")
      .run({ id, name: input.name, description: input.description ?? null });

    const updated = this.getEntryById(id);
    if (!updated) throw new Error(`Failed to read back updated CSV analytic entry ${id}.`);
    return updated;
  }

  deleteEntry(id: number): void {
    const row = this.getRowById(id);
    if (!row) return;
    this.db.transaction(() => {
      this.db.exec(buildDropTableSql(row.table_name));
      this.db.prepare("DELETE FROM csv_chart_presets WHERE entry_id = ?").run(id);
      // Custom views name this entry's columns, so they mean nothing once it is gone.
      // Cleaned up here rather than by a FK, per project convention (migration 0081).
      this.db.prepare("DELETE FROM csv_custom_views WHERE entry_id = ?").run(id);
      this.db.prepare("DELETE FROM csv_analytics_entries WHERE id = ?").run(id);
    })();
  }

  private toPresetDomain(row: CsvChartPresetRow): CsvChartPreset {
    return {
      id: row.id,
      entryId: row.entry_id,
      name: row.name,
      optionsJson: row.options_json,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listChartPresets(entryId: number): CsvChartPreset[] {
    const rows = this.db
      .prepare("SELECT * FROM csv_chart_presets WHERE entry_id = ? ORDER BY created_at ASC, id ASC")
      .all(entryId) as CsvChartPresetRow[];
    return rows.map((row) => this.toPresetDomain(row));
  }

  saveChartPreset(input: SaveChartPresetInput): CsvChartPreset {
    this.db
      .prepare(
        `INSERT INTO csv_chart_presets (entry_id, name, options_json)
         VALUES (@entryId, @name, @optionsJson)
         ON CONFLICT (entry_id, name) DO UPDATE SET options_json = excluded.options_json`,
      )
      .run({ entryId: input.entryId, name: input.name, optionsJson: input.optionsJson });

    const row = this.db
      .prepare("SELECT * FROM csv_chart_presets WHERE entry_id = ? AND name = ?")
      .get(input.entryId, input.name) as CsvChartPresetRow | undefined;
    if (!row) throw new Error("Failed to read back saved chart preset.");
    return this.toPresetDomain(row);
  }

  deleteChartPreset(id: number): void {
    this.db.prepare("DELETE FROM csv_chart_presets WHERE id = ?").run(id);
  }

  // --- Custom views (migration 0081) ----------------------------------------------

  private toCustomViewDomain(row: CsvCustomViewRow): CsvCustomView {
    return {
      id: row.id,
      entryId: row.entry_id,
      name: row.name,
      description: row.description ?? undefined,
      selectedColumns: JSON.parse(row.selected_columns_json) as string[],
      criteria: JSON.parse(row.criteria_json) as CsvViewCriterion[],
      orderBy: JSON.parse(row.order_by_json) as CsvViewOrderBy[],
      recordsPerPage: row.records_per_page,
      // SQLite has no boolean type — the 0/1 becomes a real boolean at this boundary
      // so nothing above the repository compares against a number.
      isEnabled: row.is_enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listCustomViews(entryId: number): CsvCustomView[] {
    const rows = this.db
      .prepare("SELECT * FROM csv_custom_views WHERE entry_id = ? ORDER BY created_at ASC, id ASC")
      .all(entryId) as CsvCustomViewRow[];
    return rows.map((row) => this.toCustomViewDomain(row));
  }

  listAllCustomViews(): CsvCustomView[] {
    const rows = this.db
      .prepare("SELECT * FROM csv_custom_views ORDER BY entry_id ASC, created_at ASC, id ASC")
      .all() as CsvCustomViewRow[];
    return rows.map((row) => this.toCustomViewDomain(row));
  }

  getCustomViewById(id: number): CsvCustomView | undefined {
    const row = this.db.prepare("SELECT * FROM csv_custom_views WHERE id = ?").get(id) as
      | CsvCustomViewRow
      | undefined;
    return row ? this.toCustomViewDomain(row) : undefined;
  }

  isCustomViewNameTaken(entryId: number, name: string, excludingId?: number): boolean {
    const row = this.db
      .prepare("SELECT id FROM csv_custom_views WHERE entry_id = ? AND name = ? AND id != ?")
      .get(entryId, name, excludingId ?? -1) as { id: number } | undefined;
    return row !== undefined;
  }

  createCustomView(input: CreateCsvCustomViewInput): CsvCustomView {
    const result = this.db
      .prepare(
        `INSERT INTO csv_custom_views
           (entry_id, name, description, selected_columns_json, criteria_json,
            order_by_json, records_per_page, is_enabled)
         VALUES (@entryId, @name, @description, @selectedColumnsJson, @criteriaJson,
                 @orderByJson, @recordsPerPage, @isEnabled)`,
      )
      .run({
        entryId: input.entryId,
        name: input.name,
        description: input.description ?? null,
        selectedColumnsJson: JSON.stringify(input.selectedColumns),
        criteriaJson: JSON.stringify(input.criteria),
        orderByJson: JSON.stringify(input.orderBy),
        recordsPerPage: input.recordsPerPage,
        isEnabled: input.isEnabled ? 1 : 0,
      });

    const created = this.getCustomViewById(Number(result.lastInsertRowid));
    if (!created) throw new Error("Failed to read back newly created custom view.");
    return created;
  }

  updateCustomView(id: number, input: UpdateCsvCustomViewInput): CsvCustomView {
    this.db
      .prepare(
        `UPDATE csv_custom_views
         SET name = @name, description = @description,
             selected_columns_json = @selectedColumnsJson, criteria_json = @criteriaJson,
             order_by_json = @orderByJson, records_per_page = @recordsPerPage,
             is_enabled = @isEnabled
         WHERE id = @id`,
      )
      .run({
        id,
        name: input.name,
        description: input.description ?? null,
        selectedColumnsJson: JSON.stringify(input.selectedColumns),
        criteriaJson: JSON.stringify(input.criteria),
        orderByJson: JSON.stringify(input.orderBy),
        recordsPerPage: input.recordsPerPage,
        isEnabled: input.isEnabled ? 1 : 0,
      });

    const updated = this.getCustomViewById(id);
    if (!updated) throw new Error(`Failed to read back updated custom view ${id}.`);
    return updated;
  }

  setCustomViewEnabled(id: number, isEnabled: boolean): CsvCustomView {
    this.db
      .prepare("UPDATE csv_custom_views SET is_enabled = @isEnabled WHERE id = @id")
      .run({ id, isEnabled: isEnabled ? 1 : 0 });

    const updated = this.getCustomViewById(id);
    if (!updated) throw new Error(`Failed to read back custom view ${id} after enabling.`);
    return updated;
  }

  deleteCustomView(id: number): void {
    this.db.prepare("DELETE FROM csv_custom_views WHERE id = ?").run(id);
  }

  readCustomViewPage(view: CsvCustomView, page: number): CsvViewPage {
    const entryRow = this.getRowById(view.entryId);
    if (!entryRow) throw new Error(`CSV analytic entry ${view.entryId} not found.`);
    const entryColumns = JSON.parse(entryRow.columns_json) as CsvColumnDefinition[];

    // All query construction is in the pure compiler; this method only binds and pages.
    const compiled = compileViewQuery({
      tableName: entryRow.table_name,
      entryColumns,
      selectedColumns: view.selectedColumns,
      criteria: view.criteria,
      orderBy: view.orderBy,
      recordsPerPage: view.recordsPerPage,
      page,
    });

    const { count: totalRows } = this.db.prepare(compiled.countSql).get(...compiled.params) as {
      count: number;
    };
    const rows = this.db
      .prepare(compiled.sql)
      .raw()
      .all(...compiled.params) as (string | number | null)[][];

    const recordsPerPage = Math.max(1, Math.floor(view.recordsPerPage));
    return {
      columns: compiled.columns,
      rows,
      totalRows,
      page: Math.max(1, Math.floor(page)),
      // An empty result is one (empty) page, not zero — the pager needs a page to be on.
      pageCount: Math.max(1, Math.ceil(totalRows / recordsPerPage)),
      recordsPerPage,
    };
  }
}
