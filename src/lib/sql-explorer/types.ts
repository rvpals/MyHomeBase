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

/** One documented table: its name and what it is for. */
export type TableReferenceRow = [tableName: string, description: string];

/** The tables of one module, as the reference card renders them. */
export interface TableReferenceGroup {
  /** The three-letter table prefix, e.g. "stk_". Empty for "Unclassified". */
  prefix: string;
  /** Heading — the module's short name, or "Platform" for the sys_ tables. */
  module: string;
  /** One line under the heading. Empty when the group needs no preamble. */
  summary: string;
  tables: TableReferenceRow[];
  /** Optional trailing caveat, e.g. the runtime-created csv_ dataset tables. */
  note?: string;
}

/** The four things SQLite keeps in `sqlite_master`. */
export type SchemaObjectKind = "table" | "view" | "index" | "trigger";

/** One row of `sqlite_master`, as the tree lists it. */
export interface SchemaObject {
  name: string;
  kind: SchemaObjectKind;
  /** The table an index or trigger hangs off. Empty for a table or view. */
  tableName: string;
  /**
   * The CREATE statement SQLite stored. Null for the indexes SQLite creates
   * itself to back a PRIMARY KEY or UNIQUE constraint — those have no SQL of
   * their own, which is how the panel knows to say so.
   */
  sql: string | null;
}

/** One group of the tree: a top-level node and its children. */
export interface SchemaObjectGroup {
  kind: SchemaObjectKind;
  /** Plural heading — "Tables", "Views", "Indexes", "Triggers". */
  label: string;
  objects: SchemaObject[];
}

/** A capped read of one table's rows, for the right-hand grid. */
export interface TablePage {
  tableName: string;
  columns: string[];
  rows: unknown[][];
  /** Rows in the table, which may exceed those returned. */
  totalRows: number;
  /** The LIMIT applied. */
  limit: number;
  /** True when `totalRows` exceeds what was read. */
  isTruncated: boolean;
}

export type SqlExecutionResult =
  | { kind: "query"; columns: string[]; rows: unknown[][] }
  | { kind: "statement"; changes: number };
