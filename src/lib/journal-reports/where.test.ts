import { describe, expect, it } from "vitest";
import { ReportSqlError } from "./sql-guard";
import type { JournalReport } from "./types";
import { compileReportWhere, isReportSortField, reportOrderBy } from "./where";

function report(overrides: Partial<JournalReport> = {}): JournalReport {
  return {
    id: 1,
    name: "Test",
    description: "",
    whereMode: "filter",
    whereQuery: "",
    whereSql: "",
    sortField: "date",
    sortDirection: "desc",
    maxRows: 0,
    isBuiltin: false,
    sortOrder: 1,
    createdAt: "2026-10-07T00:00:00.000Z",
    updatedAt: "2026-10-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("compileReportWhere", () => {
  it("excludes encrypted entries when there is no condition at all", () => {
    // The whole point: an encrypted entry has title '' and content '', so it
    // would print as a blank row. The exclusion is never optional.
    expect(compileReportWhere(report())).toEqual({ sql: "e.is_encrypted = 0", params: {} });
  });

  it("excludes encrypted entries alongside a filter query", () => {
    const compiled = compileReportWhere(report({ whereQuery: "title ~ rome" }));
    expect(compiled.sql).toContain("e.is_encrypted = 0");
    expect(compiled.sql).toMatch(/^\(.*\) AND e\.is_encrypted = 0$/);
    expect(Object.keys(compiled.params).length).toBeGreaterThan(0);
  });

  it("excludes encrypted entries alongside a raw SQL fragment", () => {
    const compiled = compileReportWhere(
      report({ whereMode: "sql", whereSql: "e.entry_date >= '2026-01-01'" }),
    );
    expect(compiled.sql).toBe("(e.entry_date >= '2026-01-01') AND e.is_encrypted = 0");
  });

  it("parenthesises a raw fragment so an OR can't escape the exclusion", () => {
    // Unparenthesised, `a OR b AND excluded` binds as `a OR (b AND excluded)`,
    // which lets an encrypted entry back in through the left branch.
    const compiled = compileReportWhere(
      report({ whereMode: "sql", whereSql: "e.id = 1 OR e.id = 2" }),
    );
    expect(compiled.sql).toBe("(e.id = 1 OR e.id = 2) AND e.is_encrypted = 0");
  });

  it("parenthesises a filter query for the same reason", () => {
    const compiled = compileReportWhere(report({ whereQuery: "title ~ rome or title ~ oslo" }));
    expect(compiled.sql).toMatch(/^\(.+\) AND e\.is_encrypted = 0$/);
  });

  it("only reads the column its mode names", () => {
    // Both are stored so the editor can switch modes without losing text; only
    // the live one is compiled.
    const filterMode = compileReportWhere(
      report({ whereMode: "filter", whereQuery: "", whereSql: "DROP TABLE jrn_entries" }),
    );
    expect(filterMode.sql).toBe("e.is_encrypted = 0");

    const sqlMode = compileReportWhere(
      report({ whereMode: "sql", whereQuery: "title ~ ignored", whereSql: "e.id > 5" }),
    );
    expect(sqlMode.sql).toBe("(e.id > 5) AND e.is_encrypted = 0");
  });

  it("re-checks a raw fragment at run time, not just on save", () => {
    // A fragment that reached the table another way (hand-edited file, restored
    // backup) still can't execute.
    expect(() =>
      compileReportWhere(report({ whereMode: "sql", whereSql: "1=1; DROP TABLE jrn_entries" })),
    ).toThrow(ReportSqlError);
  });

  it("throws on a malformed filter query rather than matching everything", () => {
    // A filter that quietly matches everything looks exactly like one that
    // worked — on a report that means printing the whole journal.
    expect(() => compileReportWhere(report({ whereQuery: "nonsense ?? 5" }))).toThrow();
  });
});

describe("reportOrderBy", () => {
  it("maps a field to its column and the direction to a literal", () => {
    expect(reportOrderBy("date", "desc")).toBe("e.entry_date DESC, e.id DESC");
    expect(reportOrderBy("title", "asc")).toBe("e.title ASC, e.id ASC");
  });

  it("breaks ties on id so two runs of one report agree", () => {
    expect(reportOrderBy("date", "desc")).toContain("e.id");
  });

  it("falls back to date for an unknown field rather than interpolating it", () => {
    // Guards a tampered sort_field column: it indexes an allowlist, never
    // reaching SQL as text.
    expect(reportOrderBy("nonsense" as never, "desc")).toBe("e.entry_date DESC, e.id DESC");
  });

  it("treats any direction that isn't 'asc' as DESC", () => {
    expect(reportOrderBy("date", "nonsense" as never)).toContain("DESC");
  });
});

describe("isReportSortField", () => {
  it("accepts a known field and rejects anything else", () => {
    expect(isReportSortField("date")).toBe(true);
    expect(isReportSortField("placeName")).toBe(true);
    expect(isReportSortField("entry_date")).toBe(false);
    expect(isReportSortField("")).toBe(false);
  });
});
