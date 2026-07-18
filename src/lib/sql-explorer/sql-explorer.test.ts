import { describe, expect, it } from "vitest";
import { executeStatement, listTables } from "./sql-explorer";
import type { SqlExplorerRepository } from "./ports";

function fakeRepo(): SqlExplorerRepository {
  return {
    listTables() {
      return [{ name: "widgets", columns: [{ name: "id", type: "INTEGER", isPrimaryKey: true, isNotNull: true }] }];
    },
    executeStatement(sql) {
      if (sql.toUpperCase().startsWith("SELECT")) {
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
