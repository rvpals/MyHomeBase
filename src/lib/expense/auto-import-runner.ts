// Resolves everything the auto-importer needs from the composition root and
// runs one pass. Separate from auto-import.ts so that file stays a pure
// orchestration unit taking explicit dependencies, while this one knows about
// `deps`, module settings, and which user to attribute imports to.

import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { JOB_KEYS, type ScheduledRun } from "@/lib/scheduled-jobs";
import { toSqliteTimestampUtc } from "@/lib/shared/date";
import { isAdmin, listUsers } from "@/lib/user";
import { deps } from "@/lib/wiring";
import { runAutoImport, type AutoImportRunSummary } from "./auto-import";
import {
  isAutoImportEnabled,
  resolveExpenseSettings,
  shouldRunNow,
  type ExpenseSettings,
} from "./settings";

export const EXPENSE_MODULE_SLUG = "expense";
export const EXPENSE_AUTO_IMPORT_JOB_KEY = JOB_KEYS.expenseAutoImport;

/** The module's saved settings, or the disabled defaults if the module is absent. */
export function loadExpenseSettings(): ExpenseSettings {
  const expenseModule = getModuleBySlug(deps.moduleRepo, EXPENSE_MODULE_SLUG);
  return resolveExpenseSettings(
    expenseModule ? listModuleSettingsFor(deps.moduleSettingsRepo, expenseModule.id) : [],
  );
}

/**
 * Auto-imported rows still need a creator. There's no session here, so the
 * lowest-id admin is used; with no admin at all the run is skipped rather than
 * writing a made-up id.
 */
function firstAdminUserId(): number | undefined {
  const admins = listUsers(deps.userRepo)
    .filter((user) => isAdmin(user))
    .sort((a, b) => a.id - b.id);
  return admins[0]?.id;
}

/** The stored record of the last auto-import, for the Background Tasks screen. */
export function loadLastAutoImportRun(): ScheduledRun | undefined {
  return deps.scheduledRunRepo.get(EXPENSE_AUTO_IMPORT_JOB_KEY);
}

/**
 * A stored `last_run_at` as epoch millis, or `undefined` if the job has never run.
 *
 * The column holds a SQLite-style UTC timestamp (`YYYY-MM-DD HH:MM:SS`), which
 * `Date.parse` reads as *local* time unless told otherwise -- that would make the
 * interval look hours off on a NAS that isn't on UTC. The trailing "Z" is what
 * makes it unambiguous. Same helper, same reason, as `refresh-runner.ts`.
 */
function lastRunAtMs(run: ScheduledRun | undefined): number | undefined {
  if (!run) return undefined;
  const parsed = Date.parse(`${run.lastRunAt.replace(" ", "T")}Z`);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** How a finished pass reads in `sys_scheduled_runs.last_detail`. */
function describe(summary: AutoImportRunSummary): string {
  const failed = summary.files.filter((file) => file.status === "failed").length;
  const imported = summary.files.length - failed;
  const parts = [`${imported} imported`];
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(", ");
}

/**
 * Runs one auto-import pass using the saved settings, recording it in
 * `sys_scheduled_runs`. Never throws.
 *
 * The switch and the interval check moved in here from `instrumentation-node.ts`, which
 * used to hold the last-run stamp on `globalThis`. Persisting it means a restart no
 * longer re-runs the pass early, and -- the actual point -- the Background Tasks
 * screen can say whether this job has ever run at all.
 *
 * `force` is what the manual "Run import now" button and the CLI pass: it skips the
 * switch and the interval but still stamps, so pressing the button also postpones
 * the next scheduled pass rather than leaving one queued a minute later. Matches
 * `runScheduledRefreshNow`.
 */
export function runExpenseAutoImport(options: { force?: boolean } = {}): AutoImportRunSummary {
  try {
    const settings = loadExpenseSettings();

    if (!options.force) {
      // False when the switch is off, or there is no folder/interval to work from.
      if (!isAutoImportEnabled(settings)) {
        return { ran: false, reason: "Automatic importing is switched off.", files: [] };
      }
      if (
        !shouldRunNow(
          lastRunAtMs(loadLastAutoImportRun()),
          settings.autoImportIntervalMinutes,
          Date.now(),
        )
      ) {
        return { ran: false, reason: "Not due yet.", files: [] };
      }
    }

    const createdByUserId = firstAdminUserId();
    if (createdByUserId === undefined) {
      return { ran: false, reason: "No admin account to attribute imports to.", files: [] };
    }

    // Stamped before the work, so a pass slower than the heartbeat cannot overlap
    // the next one -- the same ordering the stocks refresh uses (migrations/0061).
    deps.scheduledRunRepo.start(EXPENSE_AUTO_IMPORT_JOB_KEY, toSqliteTimestampUtc(new Date()));

    const summary = runAutoImport(settings, {
      expenseRepo: deps.expenseRepo,
      mappingRepo: deps.csvImportMappingRepo,
      folder: deps.csvFolder,
      createdByUserId,
    });

    const failed = summary.files.filter((file) => file.status === "failed").length;
    // A pass that found no files is still a pass that ran: recording it is what
    // distinguishes "the scheduler is working, the folder was empty" from silence.
    const status = failed === 0 ? "ok" : summary.files.length > failed ? "partial" : "failed";
    deps.scheduledRunRepo.finish(
      EXPENSE_AUTO_IMPORT_JOB_KEY,
      status,
      summary.ran ? describe(summary) : (summary.reason ?? "nothing to do"),
    );

    return summary;
  } catch (error) {
    // A scheduled job must not take the server down; report and move on.
    const detail = error instanceof Error ? error.message : "Unknown auto-import error.";
    // Best-effort: if the throw came from the database this fails too, and there is
    // nothing further to be done from inside a timer.
    try {
      deps.scheduledRunRepo.finish(EXPENSE_AUTO_IMPORT_JOB_KEY, "failed", detail);
    } catch {
      // Deliberately ignored.
    }
    return { ran: false, reason: detail, files: [] };
  }
}
