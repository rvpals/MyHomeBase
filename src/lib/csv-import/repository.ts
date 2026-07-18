import type Database from "better-sqlite3";
import type { CsvImportMappingRepository } from "./ports";
import type { ColumnMapping, ImportType, NamedMapping } from "./types";

interface CurrentMappingRow {
  import_type: string;
  column_mapping_json: string;
}

interface NamedMappingRow {
  id: number;
  name: string;
  import_type: string;
  column_mapping_json: string;
  created_at: string;
  updated_at: string;
}

function namedMappingToDomain(row: NamedMappingRow): NamedMapping {
  return {
    id: row.id,
    name: row.name,
    importType: row.import_type as ImportType,
    columnMapping: JSON.parse(row.column_mapping_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// The real repository. Swap the database without touching any use-case.
export class SqliteCsvImportMappingRepository implements CsvImportMappingRepository {
  constructor(private db: Database.Database) {}

  getCurrentMapping(importType: ImportType): ColumnMapping | undefined {
    const row = this.db
      .prepare("SELECT * FROM csv_import_mappings WHERE import_type = ?")
      .get(importType) as CurrentMappingRow | undefined;
    return row ? JSON.parse(row.column_mapping_json) : undefined;
  }

  saveCurrentMapping(importType: ImportType, columnMapping: ColumnMapping): void {
    this.db
      .prepare(
        `INSERT INTO csv_import_mappings (import_type, column_mapping_json)
         VALUES (@importType, @columnMappingJson)
         ON CONFLICT (import_type) DO UPDATE SET column_mapping_json = excluded.column_mapping_json`,
      )
      .run({ importType, columnMappingJson: JSON.stringify(columnMapping) });
  }

  listNamedMappings(importType: ImportType): NamedMapping[] {
    const rows = this.db
      .prepare("SELECT * FROM csv_named_mappings WHERE import_type = ? ORDER BY name ASC")
      .all(importType) as NamedMappingRow[];
    return rows.map(namedMappingToDomain);
  }

  createNamedMapping(input: {
    name: string;
    importType: ImportType;
    columnMapping: ColumnMapping;
  }): NamedMapping {
    const result = this.db
      .prepare(
        `INSERT INTO csv_named_mappings (name, import_type, column_mapping_json)
         VALUES (@name, @importType, @columnMappingJson)`,
      )
      .run({ name: input.name, importType: input.importType, columnMappingJson: JSON.stringify(input.columnMapping) });

    const created = this.db
      .prepare("SELECT * FROM csv_named_mappings WHERE id = ?")
      .get(Number(result.lastInsertRowid)) as NamedMappingRow | undefined;
    if (!created) throw new Error("Failed to read back newly created named mapping.");
    return namedMappingToDomain(created);
  }

  deleteNamedMapping(id: number): void {
    this.db.prepare("DELETE FROM csv_named_mappings WHERE id = ?").run(id);
  }
}
