import {
  BACKUP_INTERVAL_LABELS,
  checkBackupReady,
  describeBackupPreflight,
  loadAttachmentSourceRoot,
  loadBackupSettings,
  loadLastBackupRun,
  runDataBackupNow,
} from "@/lib/backup";

/**
 * Runs the Data backup from a terminal — the same pass the in-process scheduler
 * runs on its heartbeat, and the same one Administration → Configuration →
 * Backup Data's "Run backup now" button triggers.
 *
 * Default behaviour respects the switch and the interval, so this is safe to point
 * an external scheduler (DSM Task Scheduler, cron) at if you would rather the clock
 * lived outside the app. `--force` ignores both — but never the preflight: a backup
 * against a folder that has gone away refuses and names the folder either way.
 *
 *   npm run cli -- run-data-backup
 *   npm run cli -- run-data-backup --force
 *   npm run cli -- run-data-backup --status
 */
export async function runDataBackupCommand(args: string[]): Promise<void> {
  const settings = loadBackupSettings();

  if (args.includes("--status")) {
    const lastRun = loadLastBackupRun();
    const source = loadAttachmentSourceRoot();
    const ready = await checkBackupReady(settings);

    console.log(`Scheduled:      ${settings.enabled ? "on" : "off"}`);
    console.log(`Interval:       ${BACKUP_INTERVAL_LABELS[settings.interval]} at ${settings.startTime}`);
    console.log(`Attachments:    ${source || "(no source folder set)"}`);
    console.log(`  backed up to: ${settings.attachmentRoot || "(not set)"}`);
    console.log(`Database to:    ${settings.databaseRoot || "(not set)"}`);
    console.log(`Keeping:        ${settings.keepCount} archive(s)`);
    console.log(`Ready:          ${ready.ok ? "yes" : describeBackupPreflight(ready.failure)}`);
    console.log(
      lastRun
        ? `Last run:       ${lastRun.lastRunAt} — ${lastRun.status ?? "interrupted"}${
            lastRun.detail ? ` (${lastRun.detail})` : ""
          }`
        : "Last run:       never",
    );
    return;
  }

  const summary = await runDataBackupNow({ force: args.includes("--force") });

  if (!summary.ran) {
    console.log(`Nothing ran: ${summary.reason ?? "not due."}`);
    // A refusal is only an error when it was explicitly asked for: a scheduled
    // invocation that is simply not due yet must not fail an external scheduler.
    if (args.includes("--force")) process.exitCode = 1;
    return;
  }

  console.log(`Backed up: ${summary.detail}`);

  // Non-zero on a wholly failed pass so an external scheduler can notice. A
  // `partial` -- the archive landed but an attachment or two did not -- is
  // deliberately a success, matching how the stock refresh treats one bad ticker.
  if (summary.status === "failed") process.exitCode = 1;
}
