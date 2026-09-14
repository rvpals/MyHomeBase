import { beforeEach, describe, expect, it } from "vitest";
import {
  countTableRows,
  executeReadOnlyQuery,
  executeStatement,
  listTables,
  truncateTable,
} from "./sql-explorer";
import type { SqlExplorerRepository } from "./ports";

// Table names the fake was asked to truncate, so a test can assert the
// use-case actually reached the repository (and only for the right table).
let truncated: string[] = [];

function fakeRepo(overrides: Partial<SqlExplorerRepository> = {}): SqlExplorerRepository {
  return {
    listTables() {
      return [{ name: "widgets", columns: [{ name: "id", type: "INTEGER", isPrimaryKey: true, isNotNull: true }] }];
    },
    listSchemaObjects() {
      return [{ name: "widgets", kind: "table" as const, tableName: "", sql: "CREATE TABLE widgets (id INTEGER)" }];
    },
    readTablePage(tableName, limit) {
      if (tableName !== "widgets") throw new Error(`No such table or view: ${tableName}`);
      return {
        tableName,
        columns: ["id"],
        rows: [[1], [2]],
        totalRows: 2,
        limit,
        isTruncated: false,
      };
    },
    executeStatement(sql) {
      // Mirrors SqliteSqlExplorerRepository: trim first, then decide whether the
      // statement takes the read path. (Without the trim this fake would report a
      // "statement" for a perfectly valid indented SELECT.)
      const trimmed = sql.trim();
      if (/^(SELECT|PRAGMA|EXPLAIN)/i.test(trimmed)) {
        return { kind: "query", columns: ["id"], rows: [[1], [2]] };
      }
      return { kind: "statement", changes: 1 };
    },
    countRows(tableName) {
      if (tableName !== "widgets") throw new Error(`No such table: ${tableName}`);
      return 42;
    },
    readBlobCell: () => undefined,
    truncateTable(tableName) {
      if (tableName !== "widgets") throw new Error(`No such table: ${tableName}`);
      truncated.push(tableName);
      return 42;
    },
    ...overrides,
  };
}

describe("listTables", () => {
  it("returns the repository's table list", () => {
    expect(listTables(fakeRepo())).toEqual([
      { name: "widgets", columns: [{ name: "id", type: "INTEGER", isPrimaryKey: true, isNotNull: true }] },
    ]);
  });
});

describe("executeStatement", () => {
  it("passes a valid SQL string through to the repository", () => {
    expect(executeStatement(fakeRepo(), "SELECT * FROM widgets")).toEqual({
      kind: "query",
      columns: ["id"],
      rows: [[1], [2]],
    });
  });

  it("rejects an empty statement before it reaches the repository", () => {
    expect(() => executeStatement(fakeRepo(), "")).toThrow();
  });

  // A `SELECT *` over a table with an image column would otherwise serialise a
  // whole file per row into the response.
  it("describes a BLOB in a query result instead of returning its bytes", () => {
    const png = new Uint8Array(2048);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const repo = fakeRepo({
      executeStatement: () => ({ kind: "query", columns: ["avatar"], rows: [[png]] }),
    });

    const result = executeStatement(repo, "SELECT avatar FROM sys_users");

    expect(result).toMatchObject({ kind: "query" });
    const cell = (result as { rows: unknown[][] }).rows[0][0];
    expect(cell).toMatchObject({ kind: "blob", byteLength: 2048, mimeType: "image/png" });
    // An arbitrary SELECT has no rowid to quote, so the cell gets no address and
    // the grid renders its actions disabled.
    expect((cell as { source?: unknown }).source).toBeUndefined();
  });

  it("leaves a non-query statement result untouched", () => {
    expect(executeStatement(fakeRepo(), "DELETE FROM widgets")).toEqual({
      kind: "statement",
      changes: 1,
    });
  });
});

describe("executeReadOnlyQuery", () => {
  it("returns columns and rows for a SELECT", () => {
    expect(executeReadOnlyQuery(fakeRepo(), "SELECT * FROM widgets")).toEqual({
      columns: ["id"],
      rows: [[1], [2]],
    });
  });

  it("tolerates leading whitespace and lowercase", () => {
    expect(executeReadOnlyQuery(fakeRepo(), "  select 1 ").columns).toEqual(["id"]);
  });

  it.each([
    ["DELETE FROM widgets"],
    ["UPDATE widgets SET id = 2"],
    ["INSERT INTO widgets (id) VALUES (3)"],
    ["DROP TABLE widgets"],
    ["PRAGMA table_info('widgets')"],
    // A CTE is refused too: the repository's read-only pattern wouldn't match it,
    // so it would reach the write path.
    ["WITH x AS (SELECT 1) SELECT * FROM x"],
  ])("refuses %s", (sql) => {
    expect(() => executeReadOnlyQuery(fakeRepo(), sql)).toThrow();
  });

  it("refuses an empty statement", () => {
    expect(() => executeReadOnlyQuery(fakeRepo(), "")).toThrow();
  });

  it("throws if a non-query result somehow comes back", () => {
    // A repository that ignores the SELECT contract — the use-case must not
    // report success for a "statement" result.
    const lyingRepo: SqlExplorerRepository = {
      listTables: () => [],
      listSchemaObjects: () => [],
      readTablePage: (tableName, limit) => ({
        tableName,
        columns: [],
        rows: [],
        totalRows: 0,
        limit,
        isTruncated: false,
      }),
      executeStatement: () => ({ kind: "statement", changes: 5 }),
      countRows: () => 0,
      readBlobCell: () => undefined,
      truncateTable: () => 0,
    };
    expect(() => executeReadOnlyQuery(lyingRepo, "SELECT 1")).toThrow();
  });
});

describe("countTableRows", () => {
  it("returns the repository's count", () => {
    expect(countTableRows(fakeRepo(), "widgets")).toBe(42);
  });

  it.each([[""], ["no-hyphens"], ["drop; DROP TABLE x"], ["bad name"], ["1st_table"], ['a"b']])(
    "rejects %s before it reaches the repository",
    (name) => {
      expect(() => countTableRows(fakeRepo(), name)).toThrow();
    },
  );
});

describe("truncateTable", () => {
  beforeEach(() => {
    truncated = [];
  });

  it("returns the number of rows deleted", () => {
    expect(truncateTable(fakeRepo(), "widgets")).toBe(42);
  });

  it("reaches the repository with the table name", () => {
    truncateTable(fakeRepo(), "widgets");
    expect(truncated).toEqual(["widgets"]);
  });

  it("propagates the repository's error for a table that doesn't exist", () => {
    expect(() => truncateTable(fakeRepo(), "nope")).toThrow(/No such table/);
  });

  it.each([[""], ["users; DROP TABLE widgets"], ['widgets" --'], ["a b"], ["9lives"]])(
    "rejects %s without touching the repository",
    (name) => {
      expect(() => truncateTable(fakeRepo(), name)).toThrow();
      expect(truncated).toEqual([]);
    },
  );
});
