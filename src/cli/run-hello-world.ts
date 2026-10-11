import {
  describeHelloWorldSchedule,
  loadHelloWorldSettings,
  loadLastHelloWorldRun,
  runHelloWorldNow,
} from "@/lib/hello-world";

/**
 * Runs the "Hello, world!" job from a terminal — the same pass the in-process
 * scheduler runs on its heartbeat, and the same one Administration → Background
 * Tasks → Configuration → Hello, world!'s "Run now" button triggers.
 *
 * This is the command that answers "is the scheduler wiring sound?" without a
 * browser, a session or a working web server. `--status` reads the stored stamp;
 * `--force` writes a new one. If `--force` records a run and `--status` then shows
 * it, everything from the composition root through the run table is working, and
 * anything still not happening on a timer is the *timer*, not the job.
 *
 * Default behaviour respects the switch and the cadence, so this is safe to point an
 * external scheduler (DSM Task Scheduler, cron) at if you would rather the clock
 * lived outside the app. `--force` ignores both.
 *
 *   npm run cli -- run-hello-world
 *   npm run cli -- run-hello-world --force
 *   npm run cli -- run-hello-world --status
 */
export async function runHelloWorldCommand(args: string[]): Promise<void> {
  const settings = loadHelloWorldSettings();

  if (args.includes("--status")) {
    const lastRun = loadLastHelloWorldRun();

    console.log(`Scheduled:  ${describeHelloWorldSchedule(settings)}`);
    console.log(`Message:    ${settings.message}`);
    console.log(
      lastRun
        ? `Last run:   ${lastRun.lastRunAt} UTC — ${lastRun.status ?? "interrupted"}${
            lastRun.detail ? ` (${lastRun.detail})` : ""
          }`
        : "Last run:   never",
    );
    return;
  }

  const summary = await runHelloWorldNow({ force: args.includes("--force") });

  if (!summary.ran) {
    console.log(`Nothing ran: ${summary.reason ?? "not due."}`);
    // A refusal is only an error when it was explicitly asked for: a scheduled
    // invocation that is simply not due yet must not fail an external scheduler.
    // Same rule as run-data-backup.
    if (args.includes("--force")) process.exitCode = 1;
    return;
  }

  // The stamp is UTC, as stored. No local time is printed: the job records an
  // instant, and this terminal's zone is no more authoritative than anyone else's.
  //
  // `detail` already names the queue row this pass filed, which is the thing to go
  // and look at: the message is the job's real output, and the header badge in the
  // web app is where it shows up.
  console.log(`Ran: ${summary.detail}`);

  if (summary.status === "failed") process.exitCode = 1;
}
