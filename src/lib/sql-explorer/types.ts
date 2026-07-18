export interface TableColumn {
  name: string;
  type: string;
  isPrimaryKey: boolean;
  isNotNull: boolean;
}

export interface TableInfo {
  name: string;
  columns: TableColumn[];
}

export type SqlExecutionResult =
  | { kind: "query"; columns: string[]; rows: unknown[][] }
  | { kind: "statement"; changes: number };
