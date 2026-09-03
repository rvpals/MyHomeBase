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

  return { ...page, rows: page.rows.map((row) => row.map(toDisplayValue)) };
}

/**
 * Narrows a raw SQLite cell to something a grid can render.
 *
 * BLOBs are summarised rather than sent: the avatar, cover-art and card-image
 * columns hold whole files, and serialising those into the page would cost
 * megabytes per row and render as line noise.
 */
export function toDisplayValue(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return `<BLOB ${formatByteSize(value.byteLength)}>`;
  return String(value);
}

/** Byte counts as a person reads them — "24 KB", not "24576". */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
