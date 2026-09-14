import { describeBlobCell, type BlobCell, type BlobCellSource } from "./blob-cells";
import type { SqlExplorerRepository } from "./ports";
import { tableNameSchema } from "./schema";
import type { SchemaObject, SchemaObjectGroup, SchemaObjectKind, TablePage } from "./types";

/**
 * The default row cap for a table read.
 *
 * The grid takes already-fetched rows, so this is what stands between the
 * browser and every row of a table like `mus_tracks`. The panel says what it
 * isn't showing and points at the SQL Query tab for the rest.
 */
export const TABLE_PAGE_LIMIT = 500;

/** The tree's top-level nodes, in the order they render. */
const GROUP_ORDER: { kind: SchemaObjectKind; label: string }[] = [
  { kind: "table", label: "Tables" },
  { kind: "view", label: "Views" },
  { kind: "index", label: "Indexes" },
  { kind: "trigger", label: "Triggers" },
];

/**
 * Every schema object, grouped for the tree and sorted by name within a group.
 *
 * All four groups are always returned, empty ones included: a "Views" node that
 * says none are defined is more informative than a node that silently vanishes.
 */
export function listSchemaObjectGroups(repo: SqlExplorerRepository): SchemaObjectGroup[] {
  const objects = repo.listSchemaObjects();

  return GROUP_ORDER.map(({ kind, label }) => ({
    kind,
    label,
    objects: objects
      .filter((object) => object.kind === kind)
      .sort((left, right) => left.name.localeCompare(right.name)),
  }));
}

/** One object by name and kind, or undefined when it isn't in the schema. */
export function findSchemaObject(
  repo: SqlExplorerRepository,
  kind: SchemaObjectKind,
  name: string,
): SchemaObject | undefined {
  return repo.listSchemaObjects().find((object) => object.kind === kind && object.name === name);
}

/**
 * A capped read of one table or view, with cell values made safe to send to a
 * browser.
 *
 * The name is validated before it reaches the repository, which then resolves
 * it against `sqlite_master` and uses the *stored* name — a table name cannot be
 * a bound parameter, so it is interpolated, and both guards stand between a
 * caller's string and the SQL text.
 */
export function readTablePage(
  repo: SqlExplorerRepository,
  tableName: string,
  limit: number = TABLE_PAGE_LIMIT,
): TablePage {
  const validated = tableNameSchema.parse(tableName);
  const page = repo.readTablePage(validated, limit);

  // Each BLOB becomes a descriptor addressed by table + column + rowid, so the
  // grid can offer Save and Preview without the bytes ever riding along with the
  // rows. Where the source has no rowid — a view, a WITHOUT ROWID table — the
  // descriptor goes out without an address and the actions render disabled.
  return {
    ...page,
    rows: page.rows.map((row, rowIndex) =>
      row.map((value, columnIndex) => {
        const rowId = page.rowIds?.[rowIndex];
        const source =
          rowId === undefined
            ? undefined
            : { tableName: page.tableName, columnName: page.columns[columnIndex], rowId };
        return toDisplayValue(value, source);
      }),
    ),
  };
}

/** What a cell can be once it is safe to send to a browser. */
export type DisplayValue = string | number | null | BlobCell;

/**
 * Narrows a raw SQLite cell to something a grid can render.
 *
 * BLOBs are described rather than sent: the avatar, cover-art and card-image
 * columns hold whole files, and serialising those into the page would cost
 * megabytes per row and render as line noise. The descriptor carries the type,
 * the size and — when `source` is given — the address the bytes can be fetched
 * from, which is what lets the grid offer Save and Preview.
 */
export function toDisplayValue(value: unknown, source?: BlobCellSource): DisplayValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return describeBlobCell(value, source);
  return String(value);
}

/** Byte counts as a person reads them — "24 KB", not "24576". */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
