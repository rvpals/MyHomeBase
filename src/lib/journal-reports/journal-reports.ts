// The Journal Reports use-cases. Every one takes data and a repository and
// returns data — callable identically from the web app and the CLI.

import { tryParseFilterQuery } from "@/lib/journal";
import { unknownTokens } from "./fields";
import type { JournalReportRepository, ReportWriteData } from "./ports";
import { renderReport, wrapReportDocument } from "./render";
import { sanitizeReportHtml } from "./sanitize";
import type { SaveReportInput } from "./schema";
import { assertReadOnlyFragment, checkReadOnlyFragment } from "./sql-guard";
import { REPORT_PART_KINDS } from "./types";
import type {
  JournalReport,
  JournalReportDetail,
  JournalReportSummary,
  JournalReportWithDetails,
  RenderedReport,
  ReportSortDirection,
  ReportSortField,
} from "./types";
import { compileReportWhere, reportOrderBy } from "./where";

/** Raised when a use-case refuses the request, with a message for the reader. */
export class JournalReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalReportError";
  }
}

export function listReports(repo: JournalReportRepository): JournalReportSummary[] {
  return repo.listReports();
}

export function getReportWithDetails(
  id: number,
  repo: JournalReportRepository,
): JournalReportWithDetails | undefined {
  const report = repo.getReport(id);
  if (!report) return undefined;
  return { report, details: repo.getReportDetails(id) };
}

/**
 * Validates a report's entry selection, returning the message rather than
 * throwing so the editor can show it beside the box.
 *
 * This is the same check `compileReportWhere` makes at run time; doing it here
 * as well is what lets the editor refuse to save a broken query instead of
 * storing a report that fails when printed.
 */
export function checkReportSelection(
  whereMode: string,
  whereQuery: string,
  whereSql: string,
): { ok: true } | { ok: false; error: string } {
  if (whereMode === "sql") return checkReadOnlyFragment(whereSql);
  if (whereQuery.trim() === "") return { ok: true };
  const parsed = tryParseFilterQuery(whereQuery);
  return parsed.ok ? { ok: true } : { ok: false, error: parsed.error };
}

/**
 * Saves a report.
 *
 * `isAdmin` is passed in rather than read here: `lib` has no session. The caller
 * (the action, the CLI) supplies the answer, and this function enforces it —
 * the decision and the enforcement stay on opposite sides of the boundary, the
 * same arrangement `userHasModuleAccess` and `requireModuleAccess` use.
 */
export function saveReport(
  input: SaveReportInput,
  isAdmin: boolean,
  repo: JournalReportRepository,
): JournalReport {
  if (input.whereMode === "sql") {
    if (!isAdmin) {
      throw new JournalReportError("Only an administrator can use a raw SQL condition.");
    }
    // Throws ReportSqlError, which the caller renders. Checked again on every
    // run — see compileReportWhere.
    assertReadOnlyFragment(input.whereSql);
  } else {
    const selection = checkReportSelection(input.whereMode, input.whereQuery, input.whereSql);
    if (!selection.ok) throw new JournalReportError(selection.error);
  }

  if (input.id !== undefined && !repo.getReport(input.id)) {
    throw new JournalReportError("That report no longer exists.");
  }

  // Every part is stored, including an empty one, so the editor's three boxes
  // keep their identity across a save. Sanitising here rather than in the editor
  // means the CLI gets the same treatment.
  const parts = REPORT_PART_KINDS.map((part) => {
    const supplied = input.parts.find((candidate) => candidate.part === part);
    return { part, html: sanitizeReportHtml(supplied?.html ?? "").html };
  });

  const data: ReportWriteData = {
    id: input.id,
    name: input.name,
    description: input.description,
    whereMode: input.whereMode as JournalReport["whereMode"],
    whereQuery: input.whereQuery,
    whereSql: input.whereSql,
    sortField: input.sortField as ReportSortField,
    sortDirection: input.sortDirection as ReportSortDirection,
    maxRows: input.maxRows,
    parts,
  };

  return repo.saveReport(data);
}

/**
 * Deletes a report, refusing a builtin.
 *
 * Enforced here rather than by a constraint so the refusal is a sentence the
 * reader can act on instead of a foreign-key error. The six seeded reports stay
 * editable — only deletion is blocked, so the starter set can't be lost.
 */
export function deleteReport(id: number, repo: JournalReportRepository): void {
  const report = repo.getReport(id);
  if (!report) throw new JournalReportError("That report no longer exists.");
  if (report.isBuiltin) {
    throw new JournalReportError(
      "That is a built-in report. You can edit it, but it can't be deleted.",
    );
  }
  repo.deleteReport(id);
}

/**
 * Copies a report, including its template.
 *
 * The copy is never a builtin however it started, so duplicating a builtin is
 * the supported way to get an editable, deletable variant of one.
 */
export function duplicateReport(id: number, repo: JournalReportRepository): JournalReport {
  const existing = getReportWithDetails(id, repo);
  if (!existing) throw new JournalReportError("That report no longer exists.");

  return repo.saveReport({
    name: `${existing.report.name} (copy)`,
    description: existing.report.description,
    whereMode: existing.report.whereMode,
    whereQuery: existing.report.whereQuery,
    whereSql: existing.report.whereSql,
    sortField: existing.report.sortField,
    sortDirection: existing.report.sortDirection,
    maxRows: existing.report.maxRows,
    parts: REPORT_PART_KINDS.map((part) => ({
      part,
      html: existing.details.find((detail) => detail.part === part)?.html ?? "",
    })),
  });
}

export interface RunReportOptions {
  /** Overrides the report's own `maxRows` — the editor's preview uses this. */
  limit?: number;
  dismissedWords?: readonly string[];
  generatedAt?: Date;
}

/**
 * Runs a report: compile the selection, fetch the entries, render the template.
 *
 * Throws `FilterQueryError` / `ReportSqlError` / `JournalReportError` with a
 * message meant for the reader. Deliberately never degrades to an unfiltered
 * run — printing the whole journal when one month was asked for is the worst
 * failure available here, and it looks like success.
 */
export function runReport(
  id: number,
  repo: JournalReportRepository,
  options: RunReportOptions = {},
): RenderedReport & { report: JournalReport } {
  const loaded = getReportWithDetails(id, repo);
  if (!loaded) throw new JournalReportError("That report no longer exists.");

  const rendered = renderReportFor(loaded.report, loaded.details, repo, options);
  return { ...rendered, report: loaded.report };
}

/**
 * Renders a header + details pair that may not be saved yet.
 *
 * Split out of `runReport` so the editor's live preview runs the exact same
 * path as a real print — a preview that rendered differently from the thing it
 * previews would be worse than no preview.
 */
export function renderReportFor(
  report: JournalReport,
  details: JournalReportDetail[],
  repo: JournalReportRepository,
  options: RunReportOptions = {},
): RenderedReport {
  const where = compileReportWhere(report);
  const orderBy = reportOrderBy(report.sortField, report.sortDirection);

  // The preview's cap wins when present; otherwise the report's own. 0 = no
  // limit, which the repository reads as "omit the LIMIT clause".
  const limit = options.limit ?? report.maxRows;
  const entries = repo.findReportEntries(where, orderBy, limit);

  return renderReport({
    report,
    details,
    entries,
    dismissedWords: options.dismissedWords,
    generatedAt: options.generatedAt,
  });
}

/** How many entries a report covers, for the editor's "matches N entries" line. */
export function countReportMatches(report: JournalReport, repo: JournalReportRepository): number {
  return repo.countReportEntries(compileReportWhere(report));
}

/** A rendered report as a standalone file, for the Download button and the CLI. */
export function reportDocument(name: string, html: string): string {
  return wrapReportDocument(name, html);
}

/** `Year in Review` -> `year-in-review-2026-10-07.html`. */
export function reportFileName(name: string, on: Date = new Date()): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "report";
  return `${slug}-${on.toISOString().slice(0, 10)}.html`;
}

/**
 * The template tokens a report uses that aren't real fields, by part.
 *
 * Surfaced by the editor as a warning: a typo'd `{{titel}}` renders as nothing,
 * which is indistinguishable from a field that happened to be empty.
 */
export function reportTemplateWarnings(
  details: JournalReportDetail[],
): { part: string; tokens: string[] }[] {
  return details
    .map((detail) => ({ part: detail.part, tokens: unknownTokens(detail.html) }))
    .filter((entry) => entry.tokens.length > 0);
}
