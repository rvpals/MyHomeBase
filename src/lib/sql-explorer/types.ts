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
  /**
   * The SQLite rowid of each row, positionally matching `rows` — the address a
   * BLOB cell's Save/Preview needs to fetch its bytes back.
   *
   * Undefined for a WITHOUT ROWID table or a view, which have no rowid to quote;
   * a blob in one of those renders as a summary with its actions disabled.
   */
  rowIds?: number[];
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

/** One table as the Modules tab lists it. */
export interface ModuleTableRow {
  name: string;
  /** From the static reference; undefined when it isn't documented. */
  description?: string;
}

/**
 * The tables of one module, for the Modules tab's tree.
 *
 * `isModule` is false for exactly one group — the trailing "Non-Modules" — so
 * the view can render it differently without matching on its label.
 */
export interface ModuleTableGroup {
  /** Module slug, or "non-modules" for the leftovers. Keys tree selection. */
  key: string;
  /** Heading — the module's short name from `sys_modules`. */
  label: string;
  /** The three-letter table prefix, e.g. "stk_". Empty for "Non-Modules". */
  prefix: string;
  /** The module's registered icon. Absent for "Non-Modules". */
  icon?: string;
  isModule: boolean;
  tables: ModuleTableRow[];
}
