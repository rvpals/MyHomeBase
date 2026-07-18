import type { ColumnMapping, ImportType, NamedMapping } from "./types";

export interface CsvImportMappingRepository {
  getCurrentMapping(importType: ImportType): ColumnMapping | undefined;
  saveCurrentMapping(importType: ImportType, columnMapping: ColumnMapping): void;

  listNamedMappings(importType: ImportType): NamedMapping[];
  createNamedMapping(input: { name: string; importType: ImportType; columnMapping: ColumnMapping }): NamedMapping;
  deleteNamedMapping(id: number): void;
}
