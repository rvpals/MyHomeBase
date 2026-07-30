import { describe, expect, it } from "vitest";
import { executeReadOnlyQuery, executeStatement, listTables } from "./sql-explorer";
import type { SqlExplorerRepository } from "./ports";

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
    };
    expect(() => executeReadOnlyQuery(lyingRepo, "SELECT 1")).toThrow();
  });
});
