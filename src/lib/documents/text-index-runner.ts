// Resolves everything the document text-indexing job needs from the composition root
// and runs one pass. Separate from `text-index-job.ts` so that file stays pure and
// testable without a database, while this one knows about `deps`, module settings and
// the last-run table.
//
// Same split, and the same reasons, as src/lib/hello-world/runner.ts.

import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { toSqliteTimestampUtc } from "@/lib/shared/date";
import { deps } from "@/lib/wiring";
import { JOB_KEYS } from "@/lib/scheduled-jobs/types";
import type { ScheduledRun, ScheduledRunStatus } from "@/lib/scheduled-jobs/types";
import { nodeTextExtractionEngines } from "./text-engines";
import { describeTextIndexPass, runTextIndexPass } from "./text-index";
import {
  isTextIndexPassDue,
  resolveTextIndexJobSettings,
  type TextIndexJobSettings,
} from "./text-index-job";
import { DOCUMENTS_MODULE_SLUG, resolveDocumentSettings } from "./settings";

export const TEXT_INDEX_JOB_KEY = JOB_KEYS.documentTextIndex;

export interface TextIndexRunSummary {
  ran: boolean;
  status?: ScheduledRunStatus;
  /** One line for the admin card and the CLI. */
  detail: string;
  reason?: string;
}

/** The module's rows, or an empty list when the module has never been configured. */
function moduleSettingRows(): { key: string; value: string }[] {
  // `appModule`, not `module`: Next reserves that identifier, and assigning to it is
  // a lint error. Same name `settings.ts` uses for the same lookup.
  const appModule = getModuleBySlug(deps.moduleRepo, DOCUMENTS_MODULE_SLUG);
  if (!appModule) return [];
  return listModuleSettingsFor(deps.moduleSettingsRepo, appModule.id);
}

/** The saved settings, or the disabled defaults when nothing has been configured. */
export function loadTextIndexJobSettings(): TextIndexJobSettings {
  return resolveTextIndexJobSettings(moduleSettingRows());
}

/** The stored record of the last pass, for the admin card and the CLI. */
export function loadLastTextIndexRun(): ScheduledRun | undefined {
  return deps.scheduledRunRepo.get(TEXT_INDEX_JOB_KEY);
}

/**
 * A stored `last_run_at` as epoch millis, or `undefined` if the job has never run.
 *
 * The column holds a SQLite-style UTC timestamp, which `Date.parse` reads as *local*
 * time unless told otherwise — that would make the cadence look hours off on a NAS
 * that is not on UTC. The trailing "Z" is what makes it unambiguous. Same function,
 * and the same reasoning, as the backup and Hello, world! runners.
 */
function lastRunAtMs(run: ScheduledRun | undefined): number | undefined {
  if (!run) return undefined;
  const parsed = Date.parse(`${run.lastRunAt.replace(" ", "T")}Z`);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Runs one indexing pass, recording it in `sys_scheduled_runs`. **Never throws** — a
 * scheduled job must not take the server down.
 *
 * `force` is what the admin "Run now" button and the CLI's `--force` pass: it skips
 * the switch and the cadence check but still stamps the run, so pressing the button
 * also postpones the next scheduled pass rather than leaving one queued. Same
 * contract as the other runnable jobs.
 *
 * ## What a pass costs
 *
 * Unbounded per page, bounded per file: it drains up to `batchSize` files in one go.
 * A batch of digital PDFs is a second or two; a batch of scans can occupy the NAS for
 * minutes and holds ~320MB of RSS while it works. That is the deliberate trade — the
 * library reaches "fully indexed" in a few passes — and `batchSize` is the brake.
 *
 * It is safe to run repeatedly because migration 0166 makes the work list shrink: a
 * file is read once, and only a re-upload puts it back.
 */
export async function runTextIndexNow(
  options: { force?: boolean } = {},
): Promise<TextIndexRunSummary> {
  const skipped = (reason: string): TextIndexRunSummary => ({ ran: false, reason, detail: reason });

  try {
    const settings = loadTextIndexJobSettings();

    if (!options.force) {
      if (!settings.enabled) return skipped("Document text indexing is switched off.");
      if (!isTextIndexPassDue(settings, lastRunAtMs(loadLastTextIndexRun()), Date.now())) {
        return skipped("Not due yet.");
      }
    }

    // Checked before the stamp: a job that cannot work should not record a run it
    // did not do. The folder is a module setting, so this is a normal state on a
    // fresh install rather than an error.
    const root = resolveDocumentSettings(moduleSettingRows()).documentRoot;
    if (root.trim() === "") {
      return skipped("No document folder is set, so there is nothing to read.");
    }

    // Stamped before the work, exactly as the other runners do: the repository
    // derives the history row from the start/finish pair, so a job that stamped only
    // at the end would silently have no history. It also matters more here than
    // elsewhere — a pass can run for minutes, and the admin screen should say
    // "running" rather than "last run: hours ago" while it does.
    deps.scheduledRunRepo.start(TEXT_INDEX_JOB_KEY, toSqliteTimestampUtc(new Date()));

    const result = await runTextIndexPass(
      {
        repo: deps.documentsRepo,
        files: { store: deps.documentFileStore, root },
        engines: nodeTextExtractionEngines,
        // Supplied only here, not from the OCR button's call: this is the pass
        // nobody watches, so it is the one worth a line per file. Writes nothing
        // while the DEBUG switch is off, which is the default.
        log: deps.systemLogger,
      },
      { limit: settings.batchSize, useOcr: settings.ocrEnabled },
    );

    const detail = describeTextIndexPass(result);
    // `partial`, not `failed`, when some files could not be read: the PASS itself
    // succeeded, and a document whose file was moved by hand is a normal state in
    // this module rather than a job error. `partial` is what makes that visible on
    // the admin card without crying wolf.
    const status: ScheduledRunStatus = result.failed > 0 ? "partial" : "ok";
    deps.scheduledRunRepo.finish(TEXT_INDEX_JOB_KEY, status, detail);
    return { ran: true, status, detail };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error.";
    try {
      deps.scheduledRunRepo.finish(TEXT_INDEX_JOB_KEY, "failed", detail);
    } catch {
      // The run table itself is unavailable. Nothing more to do — swallowing is the
      // whole contract of this function.
    }
    return { ran: false, status: "failed", detail };
  }
}
