import { resolveJournalPreferences } from "@/lib/journal";
import {
  getReportWithDetails,
  listReports,
  reportDocument,
  reportFileName,
  reportTemplateWarnings,
  runReport,
} from "@/lib/journal-reports";
import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

const JOURNAL_MODULE_SLUG = "journal";

/**
 * Journal reports from the terminal — the same use-cases the Report screen drives.
 *
 *   journal-reports list
 *   journal-reports show --id 3
 *   journal-reports run  --id 3
 *   journal-reports run  --id 3 --document
 *   journal-reports run  --id 3 --limit 10
 *
 * `run` prints the rendered HTML on stdout, so a report can be piped to a file
 * or a browser without the web app:
 *
 *   npm run cli -- journal-reports run --id 3 --document > year.html
 *
 * This is the proof the render really lives in `src/lib/` — this file only reads
 * flags and prints. It is also the only way to run a report headlessly, which is
 * what makes a scheduled export possible later without touching the renderer.
 *
 * NOTE: there is no `save` subcommand. A report's template is multi-line HTML,
 * and a shell is a bad place to quote it — the web editor is the right tool for
 * building one, exactly as `journal-templates` reasons about JSON blobs. `run`
 * and `show` are the operations a terminal is actually better at.
 */
export async function journalReportsCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  const flags = parseFlags(rest);

  switch (subcommand) {
    case "list":
      return printList();
    case "show":
      return printOne(flags.id);
    case "run":
      return printRun(flags);
    default:
      console.log("Usage: journal-reports <list|show|run> [--id N] [--limit N] [--document]");
      process.exitCode = 1;
  }
}

function printList(): void {
  const reports = listReports(deps.journalReportRepo);
  if (reports.length === 0) {
    console.log("No reports.");
    return;
  }

  for (const report of reports) {
    const builtin = report.isBuiltin ? " [built-in]" : "";
    const mode = report.whereMode === "sql" ? " [sql]" : "";
    console.log(`${String(report.id).padStart(3)}  ${report.name}${builtin}${mode}`);
    if (report.description) console.log(`     ${report.description}`);
    const selection = report.whereText.trim() === "" ? "every entry" : report.whereText;
    console.log(`     selects: ${selection}`);
  }
}

function printOne(rawId?: string): void {
  const id = Number(rawId);
  if (!Number.isFinite(id) || id <= 0) {
    console.error("Pass --id N.");
    process.exitCode = 1;
    return;
  }

  const loaded = getReportWithDetails(id, deps.journalReportRepo);
  if (!loaded) {
    console.error(`No report ${id}.`);
    process.exitCode = 1;
    return;
  }

  const { report, details } = loaded;
  console.log(`${report.name}${report.isBuiltin ? " [built-in]" : ""}`);
  if (report.description) console.log(report.description);
  console.log("");
  console.log(`mode:      ${report.whereMode}`);
  console.log(`selects:   ${report.whereMode === "sql" ? report.whereSql : report.whereQuery || "(every entry)"}`);
  console.log(`order by:  ${report.sortField} ${report.sortDirection}`);
  console.log(`max rows:  ${report.maxRows === 0 ? "no limit" : report.maxRows}`);
  console.log("");

  for (const detail of details) {
    const body = detail.html.trim();
    console.log(`--- ${detail.part} ---`);
    console.log(body === "" ? "(empty)" : body);
    console.log("");
  }

  // The same warning the editor shows: a typo'd token renders as nothing, which
  // is indistinguishable from a field that happened to be empty.
  const warnings = reportTemplateWarnings(details);
  for (const warning of warnings) {
    console.log(`warning: ${warning.part} uses unrecognised fields: ${warning.tokens.join(", ")}`);
  }
}

function printRun(flags: Record<string, string>): void {
  const id = Number(flags.id);
  if (!Number.isFinite(id) || id <= 0) {
    console.error("Pass --id N.");
    process.exitCode = 1;
    return;
  }

  const rawLimit = Number(flags.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;

  // Honours the same dismissed-word preference the web app does, so a report
  // run here and run in the browser agree. The module row, its settings, then
  // resolve -- resolveJournalPreferences takes the settings list, not a repo.
  const journalModule = getModuleBySlug(deps.moduleRepo, JOURNAL_MODULE_SLUG);
  const preferences = resolveJournalPreferences(
    journalModule ? listModuleSettingsFor(deps.moduleSettingsRepo, journalModule.id) : [],
  );

  try {
    const result = runReport(id, deps.journalReportRepo, {
      limit,
      dismissedWords: preferences.excludedWords,
    });

    // `--document` wraps the fragment in a standalone file with its own styling,
    // which is what you want when redirecting to a .html. Bare output is the
    // fragment, for piping into something else.
    if (flags.document !== undefined) {
      console.log(reportDocument(result.report.name, result.html));
      console.error(`Wrote ${reportFileName(result.report.name)} content (${result.entryCount} entries).`);
      return;
    }

    console.log(result.html);
    // Count on stderr so stdout stays pipeable.
    console.error(`${result.entryCount} entries.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "The report could not be run.");
    process.exitCode = 1;
  }
}
