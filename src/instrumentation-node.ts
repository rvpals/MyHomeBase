// Next.js calls register() once when the server starts. This is where the
// Expense CSV auto-import, the auth-event prune, and the Stocks auto-refresh are
// armed.
//
// Design notes, all of which matter for it behaving on a NAS:
//   * The heartbeat is a fixed 60s tick that re-reads the module settings each
//     time and only imports when the configured interval has elapsed. Changing
//     the interval in the UI therefore takes effect without a restart, and no
//     timer has to be torn down and rebuilt.
//   * The "Automatic importing csv from folder" switch is checked on every tick
//     rather than at startup, for the same reason: flipping it takes effect
//     within a minute either way, with no restart. A tick with the switch off
//     does nothing beyond reading the settings, so an idle scheduler is cheap.
//   * Every job's last-run stamp lives in `sys_scheduled_runs`, not on
//     `globalThis`. `start.sh` cycles the process on every deploy and restarts it
//     after any crash, so in-memory state turned "once a day" into "once per
//     boot". It is also what lets Administration -> Background Tasks answer the
//     question this file used to answer only via `app.log`: did the job run?
//   * A globalThis flag keeps dev-mode hot reload from stacking up timers.
//   * `unref()` lets the process exit normally instead of being held open by a
//     pending timer.
//   * Runs only in the Node runtime — Edge has no filesystem or SQLite. That is
//     enforced by this file's *name*: Next loads `instrumentation-node.ts` only
//     for the Node runtime, so the Edge build never traces this graph at all.
//     A `NEXT_RUNTIME !== "nodejs"` guard inside a plain `instrumentation.ts` is
//     not enough — it is a runtime check, and Turbopack still statically follows
//     the `await import()`s below into the Edge graph, which fails the build with
//     "A Node.js module is loaded ... not supported in the Edge Runtime" for
//     better-sqlite3, node:fs and node:crypto. Don't rename this back.

const HEARTBEAT_MS = 60_000;

/**
 * The auth-event prune runs on its own daily timer rather than on the 60s heartbeat:
 * a 90-day retention window doesn't move minute to minute, so checking it 1,440 times
 * a day would be pure waste. See migrations/0045.
 *
 * It used to also run 30s after every boot. It no longer does: the run is stamped in
 * `sys_scheduled_runs`, so the startup pass asks whether a day has actually elapsed.
 * On a NAS that redeploys or restarts several times an hour, "daily" previously meant
 * "every restart".
 */
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const globalForAutoImport = globalThis as unknown as {
  __expenseAutoImportStarted?: boolean;
  __authEventPruneStarted?: boolean;
  __stockAutoRefreshStarted?: boolean;
};

/** Deletes auth events past their retention window. Armed on its own daily timer. */
async function armAuthEventPrune() {
  if (globalForAutoImport.__authEventPruneStarted) return;
  globalForAutoImport.__authEventPruneStarted = true;

  // Imported lazily so the Edge/build passes never pull in better-sqlite3 — the same
  // reason the expense block below defers its own imports.
  const { runAuthEventPruneNow, DEFAULT_RETENTION_DAYS } = await import("@/lib/auth-events");

  const tick = () => {
    try {
      const summary = runAuthEventPruneNow();
      // Silent when there was nothing to do, so the log doesn't gain a daily line
      // saying "deleted 0". The Background Tasks screen shows the quiet runs.
      if (summary.ran && summary.deletedCount > 0) {
        console.log(
          `[auth-events prune] deleted ${summary.deletedCount} event(s) older than ${DEFAULT_RETENTION_DAYS} days.`,
        );
      }
    } catch (error) {
      // A throw here would become an unhandled rejection and could kill the server.
      console.error("[auth-events prune] tick failed:", error);
    }
  };

  // Once shortly after startup, deferred so it never competes with the first page
  // render. The runner's own interval check makes this a no-op unless a day has
  // genuinely elapsed, so a frequently-restarted server no longer prunes on each boot.
  const initial = setTimeout(tick, 30_000);
  initial.unref?.();

  const timer = setInterval(tick, PRUNE_INTERVAL_MS);
  timer.unref?.();

  console.log(`[auth-events prune] armed (daily, ${DEFAULT_RETENTION_DAYS}-day retention).`);
}

/**
 * The Stocks & ETFs auto-refresh: prices every position, looks up any new sector,
 * and files today's snapshot -- the same three steps the dashboard's Refresh All
 * button walks, so a day nobody pressed it is no longer a hole in the history.
 *
 * Shares the expense importer's 60s heartbeat design: the tick re-reads the
 * module settings every time, so flipping the switch or changing the interval in
 * the UI takes effect within a minute with no restart and no timer to rebuild.
 *
 * Differs in one respect, deliberately. The expense job keeps its last-run stamp
 * on `globalThis`; this one persists it in `sys_scheduled_runs`, because its
 * default interval is *daily* and `start.sh` cycles the process on every deploy
 * and restarts it after any crash. In-memory state would turn "once a day" into
 * "once per boot". See migrations/0061.
 *
 * The whole decision -- switched on? due yet? -- lives in `runScheduledRefreshNow`,
 * which never throws. This function is just the clock.
 */
async function armStockAutoRefresh() {
  if (globalForAutoImport.__stockAutoRefreshStarted) return;
  globalForAutoImport.__stockAutoRefreshStarted = true;

  // Imported lazily so the Edge/build passes never pull in better-sqlite3 --
  // same reason as the two blocks around it.
  const { runScheduledRefreshNow } = await import("@/lib/scheduled-refresh");

  const tick = async () => {
    try {
      const summary = await runScheduledRefreshNow();
      // Silent unless a pass actually ran, so an idle scheduler doesn't write a
      // line a minute saying "not due yet".
      if (summary.ran) {
        const line = `[stock auto-refresh] ${summary.detail}`;
        if (summary.status === "failed") console.error(line);
        else console.log(line);
      }
    } catch (error) {
      // Belt and braces: the runner already swallows its own errors, but an
      // unhandled rejection in a timer callback can take the server down.
      console.error("[stock auto-refresh] tick failed:", error);
    }
  };

  const timer = setInterval(tick, HEARTBEAT_MS);
  timer.unref?.();

  console.log("[stock auto-refresh] scheduler armed (60s heartbeat).");
}

export async function register() {
  // No NEXT_RUNTIME check needed: the `-node` filename already scopes this file
  // to the Node runtime. See the note at the top of the file.
  await armAuthEventPrune();
  await armStockAutoRefresh();

  if (globalForAutoImport.__expenseAutoImportStarted) return;
  globalForAutoImport.__expenseAutoImportStarted = true;

  // Imported lazily so the Edge/build passes never pull in better-sqlite3.
  const { runExpenseAutoImport } = await import("@/lib/expense/auto-import-runner");

  // The whole decision -- switched on? due yet? -- lives in `runExpenseAutoImport`
  // now, which reads its last-run stamp from `sys_scheduled_runs` and never throws.
  // This function is just the clock, matching the stocks refresh above.
  const tick = () => {
    try {
      const summary = runExpenseAutoImport();
      if (!summary.ran) {
        // "Switched off" and "not due yet" are the normal quiet path and would write
        // a line a minute, so only a real obstacle is logged.
        const quiet =
          summary.reason === "Automatic importing is switched off." ||
          summary.reason === "Not due yet.";
        if (summary.reason && !quiet) {
          console.warn(`[expense auto-import] skipped: ${summary.reason}`);
        }
        return;
      }
      for (const file of summary.files) {
        const line = `[expense auto-import] ${file.fileName}: ${file.detail}`;
        if (file.status === "failed") console.error(line);
        else console.log(line);
      }
    } catch (error) {
      // Belt and braces: the runner already swallows its own errors, but a
      // throw here would become an unhandled rejection and could kill the server.
      console.error("[expense auto-import] tick failed:", error);
    }
  };

  const timer = setInterval(tick, HEARTBEAT_MS);
  timer.unref?.();

  console.log("[expense auto-import] scheduler armed (60s heartbeat).");
}
