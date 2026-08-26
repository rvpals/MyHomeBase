import type { ScheduledRun, ScheduledRunStatus } from "./types";

/**
 * Last-run bookkeeping for background jobs. One row per job key.
 *
 * Split into `start` and `finish` rather than one `save`, because the two happen
 * at different times on purpose: the timestamp is written *before* the work so a
 * slow pass can't overlap the next tick, and the outcome is written after. A
 * single call would force the runner to choose one, and stamping only at the end
 * is what allows two passes to run at once.
 */
export interface ScheduledRunRepository {
  get(jobKey: string): ScheduledRun | undefined;
  /** Stamps a run as started now, clearing any previous outcome. */
  start(jobKey: string, startedAt: string): void;
  /** Records how the run turned out. */
  finish(jobKey: string, status: ScheduledRunStatus, detail: string): void;
}
