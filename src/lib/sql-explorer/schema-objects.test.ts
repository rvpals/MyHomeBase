import { describe, expect, it } from "vitest";
import {
  TABLE_PAGE_LIMIT,
  findSchemaObject,
  formatByteSize,
  listSchemaObjectGroups,
  readTablePage,
  toDisplayValue,
} from "./schema-objects";
import type { SqlExplorerRepository } from "./ports";
import type { SchemaObject } from "./types";

const OBJECTS: SchemaObject[] = [
  { name: "widgets", kind: "table", tableName: "", sql: "CREATE TABLE widgets (id INTEGER)" },
  { name: "gadgets", kind: "table", tableName: "", sql: "CREATE TABLE gadgets (id INTEGER)" },
  { name: "idx_widgets_id", kind: "index", tableName: "widgets", sql: "CREATE INDEX idx_widgets_id ON widgets(id)" },
  { name: "sqlite_autoindex_widgets_1", kind: "index", tableName: "widgets", sql: null },
  { name: "widgets_touch", kind: "trigger", tableName: "widgets", sql: "CREATE TRIGGER widgets_touch ..." },
];

/** A PNG-signed blob of `totalLength` bytes, so the sniffer can place it. */
function pngBytes(totalLength: number): Uint8Array {
  const bytes = new Uint8Array(totalLength);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return bytes;
}

/** Records the arguments readTablePage was called with. */
let lastRead: { tableName: string; limit: number } | undefined;

function fakeRepo(overrides: Partial<SqlExplorerRepository> = {}): SqlExplorerRepository {
  return {
    listTables: () => [],
    listSchemaObjects: () => OBJECTS,
    readTablePage(tableName, limit) {
      lastRead = { tableName, limit };
      if (tableName !== "widgets") throw new Error(`No such table or view: ${tableName}`);
      return {
        tableName,
        columns: ["id", "payload"],
        rows: [[1, pngBytes(2048)]],
        rowIds: [77],
        totalRows: 900,
        limit,
        isTruncated: true,
      };
    },
    executeStatement: () => ({ kind: "statement", changes: 0 }),
    countRows: () => 0,
    readBlobCell: () => undefined,
    truncateTable: () => 0,
    ...overrides,
  };
}

describe("listSchemaObjectGroups", () => {
  it("returns all four groups in tree order", () => {
    const groups = listSchemaObjectGroups(fakeRepo());

    expect(groups.map((group) => group.label)).toEqual(["Tables", "Views", "Indexes", "Triggers"]);
  });

  it("sorts the objects within a group by name", () => {
    const groups = listSchemaObjectGroups(fakeRepo());

    expect(groups[0].objects.map((object) => object.name)).toEqual(["gadgets", "widgets"]);
  });

  it("keeps a group with no objects rather than dropping it", () => {
    const views = listSchemaObjectGroups(fakeRepo()).find((group) => group.kind === "view");

    expect(views).toBeDefined();
    expect(views?.objects).toEqual([]);
  });
});

describe("findSchemaObject", () => {
  it("finds an object by kind and name", () => {
    expect(findSchemaObject(fakeRepo(), "trigger", "widgets_touch")?.tableName).toBe("widgets");
  });

  it("does not match the right name under the wrong kind", () => {
    expect(findSchemaObject(fakeRepo(), "table", "widgets_touch")).toBeUndefined();
  });
});

describe("readTablePage", () => {
  it("reads a table with the default cap", () => {
    const page = readTablePage(fakeRepo(), "widgets");

    expect(lastRead).toEqual({ tableName: "widgets", limit: TABLE_PAGE_LIMIT });
    expect(page.totalRows).toBe(900);
    expect(page.isTruncated).toBe(true);
  });

  it("describes a BLOB instead of returning its bytes", () => {
    const page = readTablePage(fakeRepo(), "widgets");

    expect(page.rows[0][1]).toEqual({
      kind: "blob",
      byteLength: 2048,
      mimeType: "image/png",
      isPreviewable: true,
      // Addressed by the row's rowid, so the cell can offer Save and Preview.
      source: { tableName: "widgets", columnName: "payload", rowId: 77 },
    });
  });

  it("describes a BLOB without an address when the source has no rowids", () => {
    const page = readTablePage(
      fakeRepo({
        readTablePage: (tableName, limit) => ({
          tableName,
          columns: ["id", "payload"],
          rows: [[1, pngBytes(2048)]],
          // A view has no rowid to quote.
          totalRows: 1,
          limit,
          isTruncated: false,
        }),
      }),
      "widgets",
    );

    expect(page.rows[0][1]).toMatchObject({ kind: "blob", byteLength: 2048 });
    expect((page.rows[0][1] as { source?: unknown }).source).toBeUndefined();
  });

  it("rejects a name that isn't a valid identifier before reaching the repository", () => {
    lastRead = undefined;

    expect(() => readTablePage(fakeRepo(), "widgets; DROP TABLE widgets")).toThrow();
    expect(lastRead).toBeUndefined();
  });

  it("propagates the repository's error for a table that doesn't exist", () => {
    expect(() => readTablePage(fakeRepo(), "missing")).toThrow(/No such table/);
  });
});

describe("toDisplayValue", () => {
  it("passes numbers and strings through", () => {
    expect(toDisplayValue(42)).toBe(42);
    expect(toDisplayValue("hello")).toBe("hello");
  });

  it("maps null and undefined to null", () => {
    expect(toDisplayValue(null)).toBeNull();
    expect(toDisplayValue(undefined)).toBeNull();
  });

  it("renders a bigint as text, since JSON cannot carry one", () => {
    expect(toDisplayValue(BigInt("9007199254740993"))).toBe("9007199254740993");
  });

  it("describes a BLOB rather than passing its bytes through", () => {
    const value = toDisplayValue(pngBytes(2048));

    expect(value).toMatchObject({ kind: "blob", byteLength: 2048, mimeType: "image/png" });
  });
});

describe("formatByteSize", () => {
  it("scales the unit to the size", () => {
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(2048)).toBe("2 KB");
    expect(formatByteSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
