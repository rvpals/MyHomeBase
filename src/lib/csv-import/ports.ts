import type {
  AccountNameMapping,
  ColumnMapping,
  FieldOptionsMap,
  ImportType,
  NamedMapping,
} from "./types";

export interface CsvImportMappingRepository {
  getCurrentMapping(importType: ImportType): ColumnMapping | undefined;
  saveCurrentMapping(importType: ImportType, columnMapping: ColumnMapping): void;

  listNamedMappings(importType: ImportType): NamedMapping[];
  getNamedMappingById(id: number): NamedMapping | undefined;
  createNamedMapping(input: {
    name: string;
    importType: ImportType;
    columnMapping: ColumnMapping;
    fieldOptions: FieldOptionsMap;
    accountNameMapping: AccountNameMapping;
  }): NamedMapping;
  updateNamedMapping(
    id: number,
    input: {
      name: string;
      columnMapping: ColumnMapping;
      fieldOptions: FieldOptionsMap;
      accountNameMapping: AccountNameMapping;
    },
  ): NamedMapping;
  deleteNamedMapping(id: number): void;
}
