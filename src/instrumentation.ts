// Next.js calls register() once when the server starts. This is where the
// Expense CSV auto-import is armed.
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
//   * A globalThis flag keeps dev-mode hot reload from stacking up timers.
//   * `unref()` lets the process exit normally instead of being held open by a
//     pending timer.
//   * Runs only in the Node runtime — Edge has no filesystem or SQLite.

const HEARTBEAT_MS = 60_000;

const globalForAutoImport = globalThis as unknown as {
  __expenseAutoImportStarted?: boolean;
  __expenseAutoImportLastRunMs?: number;
};

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (globalForAutoImport.__expenseAutoImportStarted) return;
  globalForAutoImport.__expenseAutoImportStarted = true;

  // Imported lazily so the Edge/build passes never pull in better-sqlite3.
  const { runExpenseAutoImport, loadExpenseSettings } = await import(
    "@/lib/expense/auto-import-runner"
  );
  const { isAutoImportEnabled, shouldRunNow } = await import("@/lib/expense/settings");

  const tick = () => {
    try {
      const settings = loadExpenseSettings();
      // False when the switch is off, or when there's no folder/interval to work from.
      if (!isAutoImportEnabled(settings)) return;

      if (
        !shouldRunNow(
          globalForAutoImport.__expenseAutoImportLastRunMs,
          settings.autoImportIntervalMinutes,
          Date.now(),
        )
      ) {
        return;
      }

      // Stamped before the run so a long import can't trigger an overlapping one.
      globalForAutoImport.__expenseAutoImportLastRunMs = Date.now();

      const summary = runExpenseAutoImport();
      if (!summary.ran) {
        if (summary.reason) console.warn(`[expense auto-import] skipped: ${summary.reason}`);
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
