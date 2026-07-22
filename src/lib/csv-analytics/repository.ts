import type Database from "better-sqlite3";
import type { CsvAnalyticsRepository } from "./ports";
import type { CreateCsvAnalyticEntryInput, SaveChartPresetInput } from "./schema";
import {
  buildCreateTableSql,
  buildDropTableSql,
  buildInsertSql,
  buildTableName,
  coerceCellValue,
  quoteIdentifier,
} from "./sql-builder";
import type { CsvAnalyticEntry, CsvChartPreset, CsvColumnDefinition, CsvEntryData, IngestResult } from "./types";

interface CsvChartPresetRow {
  id: number;
  entry_id: number;
  name: string;
  options_json: string;
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
    // so returned row arrays line up 1:1 with `columns`.
    const columnList = columns.map((column) => quoteIdentifier(column.name)).join(", ");
    const limitClause = limit !== undefined && limit > 0 ? ` LIMIT ${Math.floor(limit)}` : "";
    const rows = this.db
      .prepare(`SELECT ${columnList} FROM ${quoteIdentifier(row.table_name)}${limitClause}`)
      .raw()
      .all() as (string | number | null)[][];

    return { columns, rows };
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
               columns_json = @columnsJson, primary_key_fields_json = @primaryKeyFieldsJson
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
}
