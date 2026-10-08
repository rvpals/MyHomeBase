"use server";

// Web adapters for Journal Reports. Each validates with the module's zod schema,
// calls the use-case through `@/lib/journal-reports`, and revalidates. No logic
// lives here — the CLI drives the same functions with the same arguments.
//
// Every export authorises on its first line. An action is its own POST
// endpoint, so neither the (protected) layout nor the page's own check runs
// before it fires, and hiding the editor's SQL toggle protects nothing by
// itself: the raw-SQL path is gated by requireAdmin() below.

import { revalidatePath } from "next/cache";
import { resolveJournalPreferences } from "@/lib/journal";
import {
  countReportMatches,
  deleteReport,
  duplicateReport,
  getReportWithDetails,
  previewReportSchema,
  reportDocument,
  reportFileName,
  reportIdSchema,
  renderReportFor,
  runReport,
  saveReport,
  saveReportSchema,
  type JournalReport,
  type JournalReportDetail,
} from "@/lib/journal-reports";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { isAdmin } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { requireAdmin, requireModuleAccess } from "../../require-access";

/** The module these actions belong to, matched exactly by `requireModuleAccess`. */
const ACCESS_MODULE_SLUG = "journal";

const REPORT_PATH = "/modules/journal/report";

export interface ReportActionResult {
  ok: boolean;
  error?: string;
  reportId?: number;
}

export interface ReportRenderResult {
  ok: boolean;
  error?: string;
  html?: string;
  entryCount?: number;
  /** The whole standalone document, for the Download button. */
  document?: string;
  fileName?: string;
}

function toError(error: unknown, fallback: string): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : fallback };
}

/**
 * The reader's dismissed words, which the {{table.topWords}} placeholder honours.
 *
 * The module row, its settings, then resolve — the same three steps every
 * journal section uses. `resolveJournalPreferences` takes the settings list, not
 * a repository.
 */
function dismissedWords(): readonly string[] {
  const journalModule = getModuleBySlug(deps.moduleRepo, ACCESS_MODULE_SLUG);
  const preferences = resolveJournalPreferences(
    journalModule ? listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id) : [],
  );
  return preferences.excludedWords;
}

export async function saveReportAction(input: unknown): Promise<ReportActionResult> {
  const user = await requireModuleAccess(ACCESS_MODULE_SLUG);

  const parsed = saveReportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That report isn't valid." };
  }

  // Raw SQL is admin-only. Checked here as well as inside the use-case: the
  // use-case enforces the answer, this is the adapter that reads the session to
  // find it. requireAdmin() throws, so the UI never has to trust its own toggle.
  if (parsed.data.whereMode === "sql") await requireAdmin();

  try {
    const saved = saveReport(parsed.data, isAdmin(user), deps.journalReportRepo);
    revalidatePath(REPORT_PATH);
    return { ok: true, reportId: saved.id };
  } catch (error) {
    return toError(error, "The report could not be saved.");
  }
}

export async function deleteReportAction(id: unknown): Promise<ReportActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);

  const parsed = reportIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "That report id isn't valid." };

  try {
    deleteReport(parsed.data, deps.journalReportRepo);
    revalidatePath(REPORT_PATH);
    return { ok: true };
  } catch (error) {
    return toError(error, "The report could not be deleted.");
  }
}

export async function duplicateReportAction(id: unknown): Promise<ReportActionResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);

  const parsed = reportIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "That report id isn't valid." };

  try {
    const copy = duplicateReport(parsed.data, deps.journalReportRepo);
    revalidatePath(REPORT_PATH);
    return { ok: true, reportId: copy.id };
  } catch (error) {
    return toError(error, "The report could not be copied.");
  }
}

/** Runs a saved report, for the run screen and the Download button. */
export async function runReportAction(id: unknown): Promise<ReportRenderResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);

  const parsed = reportIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "That report id isn't valid." };

  try {
    const result = runReport(parsed.data, deps.journalReportRepo, {
      dismissedWords: dismissedWords(),
    });
    return {
      ok: true,
      html: result.html,
      entryCount: result.entryCount,
      document: reportDocument(result.report.name, result.html),
      fileName: reportFileName(result.report.name),
    };
  } catch (error) {
    return toError(error, "The report could not be run.");
  }
}

/**
 * Renders an unsaved draft for the editor's preview.
 *
 * Runs the same `renderReportFor` path a real print does — a preview that
 * rendered differently from the thing it previews would be worse than none.
 * Capped harder than a real run, because it fires while the author is typing.
 */
export async function previewReportAction(input: unknown): Promise<ReportRenderResult> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);

  const parsed = previewReportSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That draft isn't valid." };
  }

  // A preview of a raw-SQL report executes the fragment, so it is gated exactly
  // like saving one. Without this, the preview would be a way to run arbitrary
  // SQL without ever saving a report.
  if (parsed.data.whereMode === "sql") await requireAdmin();

  // A draft, not a stored row: id is 0 and the timestamps are placeholders,
  // because nothing here is read by the renderer except name and selection.
  const draft: JournalReport = {
    id: parsed.data.id ?? 0,
    name: parsed.data.name,
    description: parsed.data.description,
    whereMode: parsed.data.whereMode as JournalReport["whereMode"],
    whereQuery: parsed.data.whereQuery,
    whereSql: parsed.data.whereSql,
    sortField: parsed.data.sortField as JournalReport["sortField"],
    sortDirection: parsed.data.sortDirection as JournalReport["sortDirection"],
    maxRows: parsed.data.maxRows,
    isBuiltin: false,
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
  };

  const details: JournalReportDetail[] = parsed.data.parts.map((part, index) => ({
    id: index + 1,
    reportId: draft.id,
    part: part.part as JournalReportDetail["part"],
    html: part.html,
    sortOrder: index,
  }));

  try {
    const rendered = renderReportFor(draft, details, deps.journalReportRepo, {
      limit: parsed.data.previewLimit,
      dismissedWords: dismissedWords(),
    });
    return { ok: true, html: rendered.html, entryCount: rendered.entryCount };
  } catch (error) {
    return toError(error, "The preview could not be rendered.");
  }
}

/**
 * How many entries a draft's selection matches — the editor's "matches N
 * entries" line, which is what tells an author their query did something.
 */
export async function countReportMatchesAction(
  input: unknown,
): Promise<{ ok: boolean; error?: string; count?: number }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);

  const parsed = previewReportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That draft isn't valid." };
  if (parsed.data.whereMode === "sql") await requireAdmin();

  const draft: JournalReport = {
    id: 0,
    name: parsed.data.name,
    description: "",
    whereMode: parsed.data.whereMode as JournalReport["whereMode"],
    whereQuery: parsed.data.whereQuery,
    whereSql: parsed.data.whereSql,
    sortField: "date",
    sortDirection: "desc",
    maxRows: 0,
    isBuiltin: false,
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
  };

  try {
    return { ok: true, count: countReportMatches(draft, deps.journalReportRepo) };
  } catch (error) {
    return toError(error, "That selection could not be counted.");
  }
}

/** The editor's initial load: one report and its template. */
export async function loadReportAction(
  id: unknown,
): Promise<{ ok: boolean; error?: string; report?: JournalReport; details?: JournalReportDetail[] }> {
  await requireModuleAccess(ACCESS_MODULE_SLUG);

  const parsed = reportIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: "That report id isn't valid." };

  const loaded = getReportWithDetails(parsed.data, deps.journalReportRepo);
  if (!loaded) return { ok: false, error: "That report no longer exists." };
  return { ok: true, report: loaded.report, details: loaded.details };
}
