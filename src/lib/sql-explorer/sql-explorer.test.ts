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

function fakeRepo(): SqlExplorerRepository {
  return {
    listTables() {
      return [{ name: "widgets", columns: [{ name: "id", type: "INTEGER", isPrimaryKey: true, isNotNull: true }] }];
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
    truncateTable(tableName) {
      if (tableName !== "widgets") throw new Error(`No such table: ${tableName}`);
      truncated.push(tableName);
      return 42;
    },
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
      executeStatement: () => ({ kind: "statement", changes: 5 }),
      countRows: () => 0,
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
