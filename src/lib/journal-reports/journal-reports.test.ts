import { describe, expect, it } from "vitest";
import { FakeJournalReportRepository } from "./fake-report-repository";
import {
  JournalReportError,
  checkReportSelection,
  countReportMatches,
  deleteReport,
  duplicateReport,
  getReportWithDetails,
  listReports,
  renderReportFor,
  reportFileName,
  reportTemplateWarnings,
  runReport,
  saveReport,
} from "./journal-reports";
import { ReportSqlError } from "./sql-guard";
import type { JournalReport, ReportPartKind } from "./types";

function report(overrides: Partial<JournalReport> = {}): JournalReport {
  return {
    id: 1,
    name: "Entry Log",
    description: "A list.",
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

/** A valid save payload — the schema's defaults already applied. */
function saveInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "New Report",
    description: "",
    whereMode: "filter" as const,
    whereQuery: "",
    whereSql: "",
    sortField: "date" as const,
    sortDirection: "desc" as const,
    maxRows: 0,
    parts: [{ part: "row" as ReportPartKind, html: "<p>{{title}}</p>" }],
    ...overrides,
  } as Parameters<typeof saveReport>[0];
}

describe("listReports", () => {
  it("returns a summary carrying whichever selection is live", () => {
    const repo = new FakeJournalReportRepository([
      { report: report({ id: 1, whereMode: "filter", whereQuery: "title ~ rome", whereSql: "e.id > 1" }) },
      { report: report({ id: 2, name: "SQL one", whereMode: "sql", whereQuery: "ignored", whereSql: "e.id > 1" }) },
    ]);

    const rows = listReports(repo);
    expect(rows.find((row) => row.id === 1)?.whereText).toBe("title ~ rome");
    expect(rows.find((row) => row.id === 2)?.whereText).toBe("e.id > 1");
  });
});

describe("getReportWithDetails", () => {
  it("returns the header and its parts", () => {
    const repo = new FakeJournalReportRepository([
      { report: report(), details: [{ part: "row", html: "<p>{{title}}</p>" }] },
    ]);

    const loaded = getReportWithDetails(1, repo);
    expect(loaded?.report.name).toBe("Entry Log");
    expect(loaded?.details).toHaveLength(1);
  });

  it("returns undefined for a report that isn't there", () => {
    expect(getReportWithDetails(99, new FakeJournalReportRepository())).toBeUndefined();
  });
});

describe("checkReportSelection", () => {
  it("accepts an empty selection as 'every entry'", () => {
    expect(checkReportSelection("filter", "", "")).toEqual({ ok: true });
  });

  it("accepts a valid filter query and reports a malformed one", () => {
    expect(checkReportSelection("filter", "category = TRIP", "")).toEqual({ ok: true });
    const bad = checkReportSelection("filter", "nonsense ?? 5", "");
    expect(bad.ok).toBe(false);
  });

  it("checks the SQL column in sql mode, not the query column", () => {
    expect(checkReportSelection("sql", "nonsense ?? 5", "e.id > 1")).toEqual({ ok: true });
    const bad = checkReportSelection("sql", "", "DROP TABLE jrn_entries");
    expect(bad.ok).toBe(false);
  });
});

describe("saveReport", () => {
  it("inserts a new report and stores all three parts", () => {
    const repo = new FakeJournalReportRepository();
    const saved = saveReport(saveInput(), false, repo);

    expect(saved.id).toBe(1);
    expect(saved.isBuiltin).toBe(false);
    // Every part is stored, including the two left empty, so the editor's boxes
    // keep their identity across a save.
    expect(repo.getReportDetails(saved.id)).toHaveLength(3);
  });

  it("updates an existing report without changing isBuiltin or sortOrder", () => {
    const repo = new FakeJournalReportRepository([
      { report: report({ id: 1, isBuiltin: true, sortOrder: 4 }) },
    ]);

    const saved = saveReport(saveInput({ id: 1, name: "Renamed" }), true, repo);
    expect(saved.name).toBe("Renamed");
    // A builtin stays a builtin through an edit, and saving must not move it.
    expect(saved.isBuiltin).toBe(true);
    expect(saved.sortOrder).toBe(4);
  });

  it("refuses raw SQL mode for a non-admin", () => {
    const repo = new FakeJournalReportRepository();
    expect(() =>
      saveReport(saveInput({ whereMode: "sql", whereSql: "e.id > 1" }), false, repo),
    ).toThrow(JournalReportError);
  });

  it("allows raw SQL mode for an admin", () => {
    const repo = new FakeJournalReportRepository();
    const saved = saveReport(saveInput({ whereMode: "sql", whereSql: "e.id > 1" }), true, repo);
    expect(saved.whereMode).toBe("sql");
  });

  it("refuses a dangerous SQL fragment even for an admin", () => {
    const repo = new FakeJournalReportRepository();
    expect(() =>
      saveReport(saveInput({ whereMode: "sql", whereSql: "1=1; DROP TABLE jrn_entries" }), true, repo),
    ).toThrow(ReportSqlError);
  });

  it("refuses a malformed filter query rather than storing a report that fails when printed", () => {
    const repo = new FakeJournalReportRepository();
    expect(() => saveReport(saveInput({ whereQuery: "nonsense ?? 5" }), false, repo)).toThrow(
      JournalReportError,
    );
  });

  it("sanitises the template on the way in", () => {
    const repo = new FakeJournalReportRepository();
    const saved = saveReport(
      saveInput({ parts: [{ part: "row", html: '<p onclick="x()">{{title}}</p><script>a</script>' }] }),
      false,
      repo,
    );

    const stored = repo.getReportDetails(saved.id).find((detail) => detail.part === "row");
    expect(stored?.html).toBe("<p>{{title}}</p>");
  });

  it("refuses to update a report that no longer exists", () => {
    expect(() => saveReport(saveInput({ id: 99 }), true, new FakeJournalReportRepository())).toThrow(
      /no longer exists/,
    );
  });
});

describe("deleteReport", () => {
  it("deletes an ordinary report", () => {
    const repo = new FakeJournalReportRepository([{ report: report({ id: 1 }) }]);
    deleteReport(1, repo);
    expect(repo.getReport(1)).toBeUndefined();
  });

  it("refuses to delete a builtin, with a message saying it can still be edited", () => {
    const repo = new FakeJournalReportRepository([{ report: report({ id: 1, isBuiltin: true }) }]);
    expect(() => deleteReport(1, repo)).toThrow(/built-in/i);
    expect(repo.getReport(1)).toBeDefined();
  });

  it("refuses a report that isn't there", () => {
    expect(() => deleteReport(99, new FakeJournalReportRepository())).toThrow(/no longer exists/);
  });
});

describe("duplicateReport", () => {
  it("copies the header and the template under a new name", () => {
    const repo = new FakeJournalReportRepository([
      {
        report: report({ id: 1, name: "Entry Log", whereQuery: "category = TRIP" }),
        details: [{ part: "row", html: "<p>{{title}}</p>" }],
      },
    ]);

    const copy = duplicateReport(1, repo);
    expect(copy.name).toBe("Entry Log (copy)");
    expect(copy.whereQuery).toBe("category = TRIP");
    expect(repo.getReportDetails(copy.id).find((d) => d.part === "row")?.html).toBe(
      "<p>{{title}}</p>",
    );
  });

  it("makes the copy of a builtin deletable", () => {
    // This is the supported route to an editable, deletable variant of a builtin.
    const repo = new FakeJournalReportRepository([
      { report: report({ id: 1, isBuiltin: true }) },
    ]);

    const copy = duplicateReport(1, repo);
    expect(copy.isBuiltin).toBe(false);
    expect(() => deleteReport(copy.id, repo)).not.toThrow();
  });
});

describe("runReport", () => {
  it("renders the template against the entries the repository returns", () => {
    const repo = new FakeJournalReportRepository([
      { report: report({ id: 1 }), details: [{ part: "row", html: "<p>{{title}}</p>" }] },
    ]);
    repo.entries = [
      {
        id: 1,
        date: "2026-07-27",
        time: "",
        title: "A day out",
        content: "",
        placeName: "",
        isPinned: false,
        isLocked: false,
        isEncrypted: false,
        titleEncrypted: "",
        contentEncrypted: "",
        passwordHint: "",
        categories: [],
        tags: [],
        locations: [],
        source: "",
        externalId: "",
        externalContent: "",
        createdAt: "",
        updatedAt: "",
      },
    ] as never;

    const result = runReport(1, repo);
    expect(result.html).toContain("A day out");
    expect(result.entryCount).toBe(1);
    expect(result.report.name).toBe("Entry Log");
  });

  it("always excludes encrypted entries in the compiled selection", () => {
    const repo = new FakeJournalReportRepository([{ report: report({ id: 1 }) }]);
    runReport(1, repo);
    expect(repo.lastWhere?.sql).toContain("e.is_encrypted = 0");
  });

  it("passes the report's own maxRows as the limit, and lets an option override it", () => {
    const repo = new FakeJournalReportRepository([{ report: report({ id: 1, maxRows: 50 }) }]);

    runReport(1, repo);
    expect(repo.lastLimit).toBe(50);

    runReport(1, repo, { limit: 10 });
    expect(repo.lastLimit).toBe(10);
  });

  it("orders by the report's sort choice", () => {
    const repo = new FakeJournalReportRepository([
      { report: report({ id: 1, sortField: "title", sortDirection: "asc" }) },
    ]);
    runReport(1, repo);
    expect(repo.lastOrderBy).toBe("e.title ASC, e.id ASC");
  });

  it("refuses a report that isn't there", () => {
    expect(() => runReport(99, new FakeJournalReportRepository())).toThrow(/no longer exists/);
  });
});

describe("renderReportFor", () => {
  it("renders an unsaved draft, so the preview runs the same path as a print", () => {
    const repo = new FakeJournalReportRepository();
    const rendered = renderReportFor(
      report({ name: "Draft" }),
      [{ id: 1, reportId: 1, part: "header", html: "<h1>{{stat.reportName}}</h1>", sortOrder: 0 }],
      repo,
    );

    expect(rendered.html).toContain("Draft");
  });
});

describe("countReportMatches", () => {
  it("counts through the compiled selection", () => {
    const repo = new FakeJournalReportRepository();
    repo.entries = [{ id: 1 }, { id: 2 }] as never;
    expect(countReportMatches(report(), repo)).toBe(2);
    expect(repo.lastWhere?.sql).toContain("e.is_encrypted = 0");
  });
});

describe("reportFileName", () => {
  it("slugs the name and stamps the date", () => {
    expect(reportFileName("Year in Review", new Date("2026-10-07T00:00:00Z"))).toBe(
      "year-in-review-2026-10-07.html",
    );
  });

  it("collapses punctuation and falls back when a name slugs to nothing", () => {
    expect(reportFileName("Category & Tag Usage", new Date("2026-10-07T00:00:00Z"))).toBe(
      "category-tag-usage-2026-10-07.html",
    );
    expect(reportFileName("!!!", new Date("2026-10-07T00:00:00Z"))).toBe("report-2026-10-07.html");
  });
});

describe("reportTemplateWarnings", () => {
  it("names the unknown tokens per part, and stays quiet for a clean template", () => {
    const warnings = reportTemplateWarnings([
      { id: 1, reportId: 1, part: "header", html: "<h1>{{stat.reportName}}</h1>", sortOrder: 0 },
      { id: 2, reportId: 1, part: "row", html: "<p>{{titel}}</p>", sortOrder: 1 },
    ]);

    expect(warnings).toEqual([{ part: "row", tokens: ["titel"] }]);
  });
});
