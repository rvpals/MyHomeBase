import { describeLastRun, listScheduledJobs } from "@/lib/scheduled-jobs";
import { deps } from "@/lib/wiring";

/**
 * Prints every background job and when it last ran — the CLI half of
 * Administration -> Background Tasks.
 *
 * Worth having as a command and not just a screen: this is the thing you want when
 * the app itself is the suspect. It reads the same `sys_scheduled_runs` rows the
 * page renders, so it answers "did the scheduler ever fire?" without a browser, a
 * session, or a working web server.
 *
 *   npm run cli -- list-scheduled-jobs
 */
export async function listScheduledJobsCommand(): Promise<void> {
  const jobs = listScheduledJobs(deps.scheduledRunRepo.list());

  for (const job of jobs) {
    console.log(job.descriptor.label);
    console.log(`  key:      ${job.descriptor.key}`);
    console.log(`  ${describeLastRun(job)}`);
    console.log("");
  }

  // The switches live with each job's own module settings, so this command
  // deliberately doesn't claim to know whether a job is armed -- only what it did.
  console.log("Switches and intervals: Administration -> Background Tasks.");
}
