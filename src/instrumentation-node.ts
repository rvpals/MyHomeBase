// Where every background job is armed: the Expense CSV auto-import, the Stocks
// auto-refresh, the Data backup, "Hello, world!", and the two retention prunes.
//
// This file is NOT the Next hook -- `src/instrumentation.ts` is, and it reaches
// this module through a `NEXT_RUNTIME === "nodejs"` guard and a dynamic import.
// Arming happens as a side effect of that import (see the bottom of the file).
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
//     enforced by the `NEXT_RUNTIME` guard in `src/instrumentation.ts`, which is
//     the documented pattern, plus the lazy `await import()`s below.
//
//     A PREVIOUS VERSION OF THIS COMMENT WAS WRONG, and the mistake cost six weeks
//     of silently dead schedulers. It claimed the `-node` suffix was what scoped
//     the file to the Node runtime and said "don't rename this back". Next
//     discovers the hook by filename alone — `^instrumentation\.(ts|tsx|js|jsx)$`,
//     built from `INSTRUMENTATION_HOOK_FILENAME` in next/dist/lib/constants.js —
//     so from commit 473f2e3 (2026-08-26) the hook was simply never found and
//     `register()` was never called. A missing hook logs nothing, so the only
//     symptom was jobs that never ran while the admin screen still said "armed".
//
//     The original build failure that prompted the rename was real, but the Edge
//     graph it avoided need not exist here: `next/dist/build/index.js` only emits
//     an edge instrumentation chunk "if there are edge routes", and this app
//     declares none — no `export const runtime = "edge"`, no middleware source.

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
  __siteVisitPruneStarted?: boolean;
  __stockAutoRefreshStarted?: boolean;
  __dataBackupStarted?: boolean;
  __helloWorldStarted?: boolean;
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
 * Deletes site visits past their retention window. Armed on its own daily timer.
 *
 * A separate timer from the auth-event prune rather than a shared one, because the
 * two tables are independent and a failure in either must not stop the other — the
 * same reason each job has its own row in `sys_scheduled_runs`.
 */
async function armSiteVisitPrune() {
  if (globalForAutoImport.__siteVisitPruneStarted) return;
  globalForAutoImport.__siteVisitPruneStarted = true;

  // Imported lazily so the Edge/build passes never pull in better-sqlite3.
  const { runSiteVisitPruneNow, DEFAULT_RETENTION_DAYS } = await import("@/lib/site-visits");

  const tick = () => {
    try {
      const summary = runSiteVisitPruneNow();
      // Silent when there was nothing to do, so the log doesn't gain a daily line
      // saying "deleted 0". The Background Tasks screen shows the quiet runs.
      if (summary.ran && summary.deletedCount > 0) {
        console.log(
          `[site-visits prune] deleted ${summary.deletedCount} visit(s) older than ${DEFAULT_RETENTION_DAYS} days.`,
        );
      }
    } catch (error) {
      // A throw here would become an unhandled rejection and could kill the server.
      console.error("[site-visits prune] tick failed:", error);
    }
  };

  // Offset from the auth prune's 30s so the two don't write at the same instant on a
  // cold start. The runner's own interval check makes this a no-op unless a day has
  // genuinely elapsed.
  const initial = setTimeout(tick, 45_000);
  initial.unref?.();

  const timer = setInterval(tick, PRUNE_INTERVAL_MS);
  timer.unref?.();

  console.log(`[site-visits prune] armed (daily, ${DEFAULT_RETENTION_DAYS}-day retention).`);
}

/**
 * The Investments auto-refresh: prices every position, looks up any new sector,
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

/**
 * The Data backup: attachment files first, then a compressed database archive.
 *
 * Shares the 60s heartbeat design of the two jobs above -- the tick re-reads the
 * settings every time, so changing the folder, the cadence or the start time in the
 * UI takes effect within a minute with no restart and no timer to rebuild.
 *
 * A backup pass is much slower than the others (it copies files and compresses a
 * hundred-odd megabytes), which is exactly why `runDataBackupNow` stamps the run
 * *before* doing the work: a pass still running when the next tick fires must not be
 * started twice. See migrations/0061.
 */
async function armDataBackup() {
  if (globalForAutoImport.__dataBackupStarted) return;
  globalForAutoImport.__dataBackupStarted = true;

  // Imported lazily so the Edge/build passes never pull in better-sqlite3 --
  // same reason as the three blocks above.
  const { runDataBackupNow } = await import("@/lib/backup/backup-runner");

  const tick = async () => {
    try {
      const summary = await runDataBackupNow();
      // Silent unless a pass actually ran, so an idle scheduler doesn't write a
      // line a minute saying "not due yet".
      if (summary.ran) {
        const line = `[data backup] ${summary.detail}`;
        if (summary.status === "failed") console.error(line);
        else console.log(line);
      }
    } catch (error) {
      // Belt and braces: the runner already swallows its own errors, but an
      // unhandled rejection in a timer callback can take the server down.
      console.error("[data backup] tick failed:", error);
    }
  };

  const timer = setInterval(tick, HEARTBEAT_MS);
  timer.unref?.();

  console.log("[data backup] scheduler armed (60s heartbeat).");
}

/**
 * The "Hello, world!" job: records its configured message and the moment it ran.
 *
 * Shares the 60s heartbeat design of the three jobs above -- the tick re-reads the
 * settings every time, so changing the message or the cadence in the UI takes effect
 * within a minute with no restart and no timer to rebuild.
 *
 * This job is the reason the heartbeat is now observable at all. Every other job is
 * silent when it has nothing to do, so a scheduler that had stopped firing looked
 * exactly like one with no work -- which is how the instrumentation hook sat broken
 * for six weeks (see the comment at the top of `src/instrumentation.ts`). Arming this
 * one and watching its last-run stamp advance answers that question directly.
 */
async function armHelloWorld() {
  if (globalForAutoImport.__helloWorldStarted) return;
  globalForAutoImport.__helloWorldStarted = true;

  // Imported lazily so the Edge/build passes never pull in better-sqlite3 --
  // same reason as the three blocks above.
  const { runHelloWorldNow } = await import("@/lib/hello-world");

  const tick = async () => {
    try {
      const summary = await runHelloWorldNow();
      // Silent unless a pass actually ran, so an idle scheduler doesn't write a
      // line a minute saying "not due yet".
      if (summary.ran) {
        const line = `[hello world] ${summary.detail}`;
        if (summary.status === "failed") console.error(line);
        else console.log(line);
      }
    } catch (error) {
      // Belt and braces: the runner already swallows its own errors, but an
      // unhandled rejection in a timer callback can take the server down.
      console.error("[hello world] tick failed:", error);
    }
  };

  const timer = setInterval(tick, HEARTBEAT_MS);
  timer.unref?.();

  console.log("[hello world] scheduler armed (60s heartbeat).");
}

/**
 * Arms every job. Called by the side-effecting import at the bottom of this file.
 *
 * No `NEXT_RUNTIME` check here: `src/instrumentation.ts` has already made it, and
 * this module is only ever reached through that guard's dynamic import. Checking
 * again would imply this file is safe to import from anywhere, which it is not.
 */
async function armAll() {
  await armAuthEventPrune();
  await armSiteVisitPrune();
  await armStockAutoRefresh();
  await armDataBackup();
  await armHelloWorld();

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

// Armed on import, because that is what importing this module MEANS -- there is no
// exported `register` here any more. `src/instrumentation.ts` owns that name, and
// having two of them is how the wrong one gets called.
//
// Not awaited: `register()` must return before the server accepts requests, and
// every `arm*` function above only schedules a timer and returns. The `.catch` is
// the safety net -- an unhandled rejection during startup would take the server
// down before it ever served a page, and a job that fails to arm must not do that.
void armAll().catch((error) => {
  console.error("[instrumentation] failed to arm the background jobs:", error);
});

// Makes this file a MODULE rather than a global script, which it would otherwise
// be: every import here is dynamic and inside a function, so there is no top-level
// `import` or `export` to mark it as one. Without this, `tsc` rejects the
// `await import("./instrumentation-node")` in `src/instrumentation.ts` with
// "File ... is not a module" (TS2306).
//
// Deliberately an empty export and not a re-exported `register`: this module is
// imported for its side effect, and a second `register` in the tree is exactly the
// ambiguity that let the hook go unnoticed for six weeks.
export {};
