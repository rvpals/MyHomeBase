import type { JournalEntry } from "@/lib/journal";
import type { JournalReportRepository, ReportWriteData } from "./ports";
import type {
  JournalReport,
  JournalReportDetail,
  JournalReportSummary,
  ReportPartKind,
} from "./types";
import type { CompiledWhere } from "./where";

/**
 * In-memory JournalReportRepository for the use-case tests.
 *
 * Hand-written rather than mocked, per ARCHITECTURE.md. It reproduces the
 * behaviours of the real tables the use-cases depend on: an update keeps
 * `isBuiltin` and `sortOrder`, and saving replaces the detail rows rather than
 * merging them. A call-order mock would not catch a regression in either.
 *
 * Entry selection is NOT reproduced — compiling a WHERE into real SQL is the
 * repository's job, and the fake records what it was asked for so a test can
 * assert the compiled fragment instead. `entries` is whatever the test wants
 * back.
 */
export class FakeJournalReportRepository implements JournalReportRepository {
  private reports: JournalReport[] = [];
  private details: JournalReportDetail[] = [];
  private nextReportId = 1;
  private nextDetailId = 1;

  /** The entries `findReportEntries` hands back, regardless of the selection. */
  entries: JournalEntry[] = [];
  /** The last compiled selection, for asserting what reached the repository. */
  lastWhere?: CompiledWhere;
  lastOrderBy?: string;
  lastLimit?: number;

  constructor(seed: { report: JournalReport; details?: { part: ReportPartKind; html: string }[] }[] = []) {
    for (const item of seed) {
      this.reports.push(item.report);
      this.nextReportId = Math.max(this.nextReportId, item.report.id + 1);
      for (const [index, part] of (item.details ?? []).entries()) {
        this.details.push({
          id: this.nextDetailId++,
          reportId: item.report.id,
          part: part.part,
          html: part.html,
          sortOrder: index,
        });
      }
    }
  }

  listReports(): JournalReportSummary[] {
    return [...this.reports]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((report) => ({
        id: report.id,
        name: report.name,
        description: report.description,
        whereMode: report.whereMode,
        whereText: report.whereMode === "sql" ? report.whereSql : report.whereQuery,
        isBuiltin: report.isBuiltin,
        sortOrder: report.sortOrder,
        updatedAt: report.updatedAt,
      }));
  }

  getReport(id: number): JournalReport | undefined {
    return this.reports.find((report) => report.id === id);
  }

  getReportDetails(id: number): JournalReportDetail[] {
    return this.details
      .filter((detail) => detail.reportId === id)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  saveReport(input: ReportWriteData): JournalReport {
    const now = "2026-10-07T00:00:00.000Z";
    let saved: JournalReport;

    if (input.id === undefined) {
      saved = {
        id: this.nextReportId++,
        name: input.name,
        description: input.description,
        whereMode: input.whereMode,
        whereQuery: input.whereQuery,
        whereSql: input.whereSql,
        sortField: input.sortField,
        sortDirection: input.sortDirection,
        maxRows: input.maxRows,
        // A new report is never a builtin, however it was created — so a
        // duplicated builtin comes back deletable.
        isBuiltin: false,
        sortOrder: this.reports.length + 1,
        createdAt: now,
        updatedAt: now,
      };
      this.reports.push(saved);
    } else {
      const existing = this.reports.find((report) => report.id === input.id);
      if (!existing) throw new Error(`No report ${input.id}`);
      // isBuiltin and sortOrder deliberately survive an edit, matching the
      // real UPDATE's SET list.
      saved = {
        ...existing,
        name: input.name,
        description: input.description,
        whereMode: input.whereMode,
        whereQuery: input.whereQuery,
        whereSql: input.whereSql,
        sortField: input.sortField,
        sortDirection: input.sortDirection,
        maxRows: input.maxRows,
        updatedAt: now,
      };
      this.reports = this.reports.map((report) => (report.id === saved.id ? saved : report));
    }

    // Replace, not merge — what DELETE-then-INSERT does.
    this.details = this.details.filter((detail) => detail.reportId !== saved.id);
    input.parts.forEach((part, index) => {
      this.details.push({
        id: this.nextDetailId++,
        reportId: saved.id,
        part: part.part,
        html: part.html,
        sortOrder: index,
      });
    });

    return saved;
  }

  deleteReport(id: number): void {
    this.reports = this.reports.filter((report) => report.id !== id);
    this.details = this.details.filter((detail) => detail.reportId !== id);
  }

  findReportEntries(where: CompiledWhere, orderBy: string, limit: number): JournalEntry[] {
    this.lastWhere = where;
    this.lastOrderBy = orderBy;
    this.lastLimit = limit;
    return limit > 0 ? this.entries.slice(0, limit) : this.entries;
  }

  countReportEntries(where: CompiledWhere): number {
    this.lastWhere = where;
    return this.entries.length;
  }
}
