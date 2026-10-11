// Resolves everything the "Hello, world!" job needs from the composition root and
// runs one pass. Separate from `settings.ts` so that file stays pure and testable
// without a database, while this one knows about `deps`, app settings, and the
// last-run table.
//
// Same split, and the same reasons, as src/lib/backup/backup-runner.ts.

import { createMessage } from "@/lib/messages";
import { listSettings } from "@/lib/settings";
import { toSqliteTimestampUtc } from "@/lib/shared/date";
import { deps } from "@/lib/wiring";
import {
  describeInterval,
  isHelloWorldEnabled,
  resolveHelloWorldSettings,
  shouldRunNow,
} from "./settings";
import { HELLO_WORLD_MESSAGE_SOURCE, type HelloWorldRunSummary, type HelloWorldSettings } from "./types";
import type { ScheduledRun } from "@/lib/scheduled-jobs/types";
import { JOB_KEYS } from "@/lib/scheduled-jobs/types";

export const HELLO_WORLD_JOB_KEY = JOB_KEYS.helloWorld;

/** The saved settings, or the disabled defaults when nothing has been configured. */
export function loadHelloWorldSettings(): HelloWorldSettings {
  return resolveHelloWorldSettings(listSettings(deps.settingsRepo));
}

/** The stored record of the last pass, for the admin card and the CLI. */
export function loadLastHelloWorldRun(): ScheduledRun | undefined {
  return deps.scheduledRunRepo.get(HELLO_WORLD_JOB_KEY);
}

/**
 * A stored `last_run_at` as epoch millis, or `undefined` if the job has never run.
 *
 * The column holds a SQLite-style UTC timestamp, which `Date.parse` reads as *local*
 * time unless told otherwise -- that would make the cadence look hours off on a NAS
 * that is not on UTC. The trailing "Z" is what makes it unambiguous. Same function,
 * and the same reasoning, as the backup runner's.
 */
function lastRunAtMs(run: ScheduledRun | undefined): number | undefined {
  if (!run) return undefined;
  const parsed = Date.parse(`${run.lastRunAt.replace(" ", "T")}Z`);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Runs one pass, recording it in `sys_scheduled_runs`. Never throws -- a scheduled
 * job must not take the server down.
 *
 * What a "pass" is here: stamping the run and storing the configured message as the
 * detail. That is the whole job. The *time* it ran is the stamp itself, which the
 * admin screen renders through `UtcTime` so each reader sees it on their own clock
 * -- the job stores UTC and never formats a local time, because the server's zone is
 * the NAS's and not the reader's.
 *
 * `force` is what the manual "Run now" button and the CLI's `--force` pass: it skips
 * the switch and the cadence check but still stamps the run, so pressing the button
 * also postpones the next scheduled pass rather than leaving one queued a minute
 * later. Same contract as the other three runnable jobs.
 */
export async function runHelloWorldNow(
  options: { force?: boolean } = {},
): Promise<HelloWorldRunSummary> {
  const skipped = (reason: string): HelloWorldRunSummary => ({
    ran: false,
    reason,
    detail: reason,
  });

  try {
    const settings = loadHelloWorldSettings();

    if (!options.force) {
      if (!isHelloWorldEnabled(settings)) return skipped("Hello, world! is switched off.");
      if (!shouldRunNow(lastRunAtMs(loadLastHelloWorldRun()), settings, Date.now())) {
        return skipped("Not due yet.");
      }
    }

    // Stamped before the work, exactly as the other runners do. There is no slow
    // work here to overlap, but the start/finish pair is also what writes the
    // history row -- the repository derives it, so a job that stamped only at the
    // end would silently have no history.
    deps.scheduledRunRepo.start(HELLO_WORLD_JOB_KEY, toSqliteTimestampUtc(new Date()));

    // The pass's whole output: one message in the household queue. That is what
    // makes this job a *test* of the scheduler rather than another silent one --
    // the header badge climbs on every shell in the app, so a working heartbeat is
    // visible from wherever you happen to be standing, with no log to tail and no
    // admin screen to sit on.
    //
    // `createMessage` validates through the module's own schema, so this files the
    // same shape the Investments monitor and the CLI do -- the "future scheduled
    // job" its doc comment anticipates.
    //
    // Nothing prunes the queue on a timer, so an armed minute-by-minute job fills
    // it at ~1,440 rows a day. That is the honest cost of the cadence rather than a
    // bug: the admin card states the daily figure next to the interval, and
    // Administration -> Messages purges by age.
    const message = createMessage(deps.messageRepo, {
      title: settings.message,
      // The body carries what the title cannot: which pass this was, as the stamp
      // the run table holds. UTC, like every stored instant -- the queue renders it
      // for the reader's own clock.
      body: `Filed by the Hello, world! background task at ${toSqliteTimestampUtc(new Date())} UTC.`,
      source: HELLO_WORLD_MESSAGE_SOURCE,
    });

    const detail = `${settings.message} (queued as message #${message.id})`;
    deps.scheduledRunRepo.finish(HELLO_WORLD_JOB_KEY, "ok", detail);

    return { ran: true, status: "ok", detail, messageId: message.id };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown error.";
    // Best-effort: if the throw came from the database itself this will fail too,
    // and there is nothing useful left to do about it.
    try {
      deps.scheduledRunRepo.finish(HELLO_WORLD_JOB_KEY, "failed", detail);
    } catch {
      // Deliberately empty -- see above.
    }
    return { ran: false, reason: detail, detail, status: "failed" };
  }
}

/** The cadence as one sentence, for the CLI's `--status`. Shared with the web card. */
export function describeHelloWorldSchedule(settings: HelloWorldSettings): string {
  return settings.enabled ? `on — ${describeInterval(settings)}` : "off";
}
