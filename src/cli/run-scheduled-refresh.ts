import {
  loadLastScheduledRun,
  loadScheduledRefreshSettings,
  runScheduledRefreshNow,
  REFRESH_INTERVAL_LABELS,
} from "@/lib/scheduled-refresh";

/**
 * Runs the scheduled refresh from a terminal — the same pass the in-process
 * scheduler runs on its heartbeat, and the same one the Configuration screen's
 * "Run refresh now" button triggers.
 *
 * Default behaviour respects the switch and the interval, so this is safe to
 * point an external scheduler (DSM Task Scheduler, cron) at if you would rather
 * the clock lived outside the app. `--force` ignores both, which is what the UI
 * button does.
 *
 *   npm run cli -- run-scheduled-refresh
 *   npm run cli -- run-scheduled-refresh --force
 *   npm run cli -- run-scheduled-refresh --status
 */
export async function runScheduledRefreshCommand(args: string[]): Promise<void> {
  const settings = loadScheduledRefreshSettings();

  if (args.includes("--status")) {
    const lastRun = loadLastScheduledRun();
    console.log(`Auto refresh: ${settings.autoRefreshEnabled ? "on" : "off"}`);
    console.log(`Interval:     ${REFRESH_INTERVAL_LABELS[settings.autoRefreshInterval]}`);
    console.log(
      lastRun
        ? `Last run:     ${lastRun.lastRunAt} — ${lastRun.status ?? "interrupted"}${
            lastRun.detail ? ` (${lastRun.detail})` : ""
          }`
        : "Last run:     never",
    );
    return;
  }

  const force = args.includes("--force");
  const summary = await runScheduledRefreshNow({ force });

  if (!summary.ran) {
    console.log(`Nothing ran: ${summary.reason ?? "not due."}`);
    return;
  }

  console.log(
    `Refreshed: ${summary.pricedCount} priced, ${summary.failedCount} failed, ` +
      `${summary.sectorsFetchedCount} sector(s), ` +
      `snapshot ${summary.snapshotSaved ? "saved" : "NOT saved"}.`,
  );

  // Non-zero on a wholly failed pass so an external scheduler can notice. A
  // `partial` is deliberately a success: one delisted ticker is not a failed run.
  if (summary.status === "failed") process.exitCode = 1;
}
