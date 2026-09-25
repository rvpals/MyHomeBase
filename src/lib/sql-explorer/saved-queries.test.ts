import { describe, expect, it } from "vitest";
import { FakeSavedQueryRepository } from "./fake-saved-query-repository";
import { deleteSavedQuery, listSavedQueries, saveQuery } from "./saved-queries";
import { saveQuerySchema, tagListSchema } from "./schema";

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Recent positions",
    description: "Everything bought this year",
    tags: "investments, debugging",
    sqlStatement: "SELECT * FROM inv_stock_positions",
    ...overrides,
  };
}

describe("saveQuery", () => {
  it("stores a query and splits its tags", () => {
    const repo = new FakeSavedQueryRepository();

    const saved = saveQuery(repo, validInput());

    expect(saved.name).toBe("Recent positions");
    expect(saved.tags).toEqual(["investments", "debugging"]);
    expect(saved.sqlStatement).toBe("SELECT * FROM inv_stock_positions");
    expect(listSavedQueries(repo)).toHaveLength(1);
  });

  it("replaces the existing row when the name is reused, keeping its id", () => {
    const repo = new FakeSavedQueryRepository();
    const first = saveQuery(repo, validInput());

    const second = saveQuery(
      repo,
      validInput({ description: "Rewritten", sqlStatement: "SELECT 1" }),
    );

    // The upsert is the whole reason the table is UNIQUE (name) — one row, not two.
    expect(listSavedQueries(repo)).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second.description).toBe("Rewritten");
    expect(second.sqlStatement).toBe("SELECT 1");
  });

  it("accepts a write statement — saving is not restricted to SELECT", () => {
    const repo = new FakeSavedQueryRepository();

    const saved = saveQuery(repo, validInput({ sqlStatement: "DELETE FROM sys_messages" }));

    // Storing a write is legitimate; what protects the reader is that loading
    // fills the editor without executing. See migration 0112.
    expect(saved.sqlStatement).toBe("DELETE FROM sys_messages");
  });

  it("rejects a blank name", () => {
    const repo = new FakeSavedQueryRepository();

    expect(() => saveQuery(repo, validInput({ name: "   " }))).toThrow();
    expect(listSavedQueries(repo)).toHaveLength(0);
  });

  it("rejects an empty statement", () => {
    const repo = new FakeSavedQueryRepository();

    expect(() => saveQuery(repo, validInput({ sqlStatement: "" }))).toThrow();
    expect(listSavedQueries(repo)).toHaveLength(0);
  });
});

describe("listSavedQueries", () => {
  it("returns the saved queries ordered by name", () => {
    const repo = new FakeSavedQueryRepository();
    saveQuery(repo, validInput({ name: "Zebra" }));
    saveQuery(repo, validInput({ name: "Apple" }));

    expect(listSavedQueries(repo).map((row) => row.name)).toEqual(["Apple", "Zebra"]);
  });

  it("returns an empty list when nothing is saved", () => {
    expect(listSavedQueries(new FakeSavedQueryRepository())).toEqual([]);
  });
});

describe("deleteSavedQuery", () => {
  it("removes the row", () => {
    const repo = new FakeSavedQueryRepository();
    const saved = saveQuery(repo, validInput());

    deleteSavedQuery(repo, saved.id);

    expect(listSavedQueries(repo)).toHaveLength(0);
  });

  it("accepts a numeric string, as the CLI supplies it", () => {
    const repo = new FakeSavedQueryRepository();
    const saved = saveQuery(repo, validInput());

    deleteSavedQuery(repo, String(saved.id));

    expect(listSavedQueries(repo)).toHaveLength(0);
  });

  it("throws when no row has that id, rather than reporting success", () => {
    const repo = new FakeSavedQueryRepository();

    expect(() => deleteSavedQuery(repo, 999)).toThrow(/No saved query with id 999/);
  });

  it("rejects an id that was never a row address", () => {
    const repo = new FakeSavedQueryRepository();

    expect(() => deleteSavedQuery(repo, 0)).toThrow();
    expect(() => deleteSavedQuery(repo, "abc")).toThrow();
  });
});

describe("tagListSchema", () => {
  it("trims, drops blanks and de-duplicates case-insensitively", () => {
    expect(tagListSchema.parse(" Investments , investments,, debugging ")).toEqual([
      "Investments",
      "debugging",
    ]);
  });

  it("treats an empty string as no tags", () => {
    expect(tagListSchema.parse("")).toEqual([]);
    expect(tagListSchema.parse("  ,  ")).toEqual([]);
  });
});

describe("saveQuerySchema", () => {
  it("trims the name and defaults the description", () => {
    const parsed = saveQuerySchema.parse({
      name: "  Totals  ",
      sqlStatement: "SELECT 1",
      tags: "",
    });

    expect(parsed.name).toBe("Totals");
    expect(parsed.description).toBe("");
    expect(parsed.tags).toEqual([]);
  });

  it("rejects a name longer than the column expects", () => {
    expect(() =>
      saveQuerySchema.parse({ name: "x".repeat(121), sqlStatement: "SELECT 1", tags: "" }),
    ).toThrow();
  });
});
