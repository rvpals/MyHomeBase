// Resolves everything the scheduled refresh needs from the composition root and
// runs one pass. Separate from scheduled-refresh.ts so that file stays a pure
// orchestration unit taking explicit dependencies, while this one knows about
// `deps`, module settings, and the last-run table.
//
// Same split, and the same reasons, as src/lib/expense/auto-import-runner.ts.

import { listModuleSettingsFor } from "@/lib/module-settings";
import { getModuleBySlug } from "@/lib/modules";
import { todayIsoLocal, toSqliteTimestampUtc } from "@/lib/shared/date";
import { deps } from "@/lib/wiring";
import { runScheduledRefresh } from "./scheduled-refresh";
import {
  isAutoRefreshEnabled,
  resolveScheduledRefreshSettings,
  shouldRunNow,
  STOCK_AUTO_REFRESH_JOB_KEY,
  STOCK_ETFS_MODULE_SLUG,
} from "./settings";
import type { ScheduledRefreshSettings, ScheduledRefreshSummary, ScheduledRun } from "./types";

/** The module's saved settings, or the disabled defaults if the module is absent. */
export function loadScheduledRefreshSettings(): ScheduledRefreshSettings {
  const stockModule = getModuleBySlug(deps.moduleRepo, STOCK_ETFS_MODULE_SLUG);
  return resolveScheduledRefreshSettings(
    stockModule ? listModuleSettingsFor(deps.moduleSettingsRepo, stockModule.id) : [],
  );
}

/** The stored record of the last auto-refresh, for the settings screen. */
export function loadLastScheduledRun(): ScheduledRun | undefined {
  return deps.scheduledRunRepo.get(STOCK_AUTO_REFRESH_JOB_KEY);
}

/**
 * A stored `last_run_at` as epoch millis, or `undefined` if the job has never run.
 *
 * The column holds a SQLite-style UTC timestamp (`YYYY-MM-DD HH:MM:SS`), which
 * `Date.parse` reads as *local* time unless it's told otherwise -- that would make
 * the interval look hours off in any non-UTC timezone, and the NAS is not on UTC.
 * The trailing "Z" is what makes it unambiguous.
 */
function lastRunAtMs(run: ScheduledRun | undefined): number | undefined {
  if (!run) return undefined;
  const parsed = Date.parse(`${run.lastRunAt.replace(" ", "T")}Z`);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Runs one pass using the saved settings, recording it in `sys_scheduled_runs`.
 * Never throws -- a scheduled job must not take the server down.
 *
 * `force` is what the manual "Run now" button and the CLI pass: it skips the
 * switch and the interval check but still stamps the run, so pressing the button
 * also postpones the next scheduled pass rather than leaving one queued a minute
 * later. The switch not gating an explicit request matches how the expense
 * importer's "Run import now" works.
 */
export async function runScheduledRefreshNow(
  options: { force?: boolean } = {},
): Promise<ScheduledRefreshSummary> {
  const skipped = (reason: string): ScheduledRefreshSummary => ({
    ran: false,
    reason,
    pricedCount: 0,
    failedCount: 0,
    sectorsFetchedCount: 0,
    snapshotSaved: false,
    detail: reason,
  });

  try {
    const settings = loadScheduledRefreshSettings();

    if (!options.force) {
      if (!isAutoRefreshEnabled(settings)) return skipped("Auto refresh is switched off.");
      if (
        !shouldRunNow(
          lastRunAtMs(loadLastScheduledRun()),
          settings.autoRefreshInterval,
          Date.now(),
        )
      ) {
        return skipped("Not due yet.");
      }
    }

    // There is nothing to price, so this is not a run: stamping it would burn the
    // whole interval on a no-op, and -- worse -- the first pass after you add your
    // first position would then wait another full interval. Checked here rather
    // than inside the pass so the decision happens before the stamp.
    if (deps.stockPositionRepo.listPositions().length === 0) {
      return skipped("No positions to refresh.");
    }

    // Stamped before the work, so a pass slower than the heartbeat cannot overlap
    // the next one. See migrations/0061.
    deps.scheduledRunRepo.start(STOCK_AUTO_REFRESH_JOB_KEY, toSqliteTimestampUtc(new Date()));

    const summary = await runScheduledRefresh({
      positionRepo: deps.stockPositionRepo,
      marketDataClient: deps.marketDataClient,
      profileRepo: deps.tickerProfileRepo,
      profileClient: deps.tickerProfileClient,
      snapshotRepo: deps.stockDailySnapshotRepo,
      today: todayIsoLocal(),
    });

    deps.scheduledRunRepo.finish(
      STOCK_AUTO_REFRESH_JOB_KEY,
      summary.status ?? (summary.ran ? "ok" : "failed"),
      summary.detail,
    );

    return summary;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown scheduled refresh error.";
    // Best-effort: if the throw came from the database itself this will fail too,
    // and there is nothing further to be done about it from inside a timer.
    try {
      deps.scheduledRunRepo.finish(STOCK_AUTO_REFRESH_JOB_KEY, "failed", detail);
    } catch {
      // Deliberately ignored.
    }
    return {
      ran: false,
      reason: detail,
      pricedCount: 0,
      failedCount: 0,
      sectorsFetchedCount: 0,
      snapshotSaved: false,
      detail,
    };
  }
}
