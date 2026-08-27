// Domain models for background-job bookkeeping: one row per job in
// `sys_scheduled_runs` (migrations/0061), plus the catalogue of jobs the
// Administration -> Background Tasks screen renders.
//
// Split out of `src/lib/scheduled-refresh/` once a second and third job needed
// the same bookkeeping. That module still owns the *stocks refresh use-case*; the
// generic "when did job X last run" half lives here, so `src/lib/expense` and
// `src/lib/auth-events` don't import a module named after stocks.

/** How a finished pass turned out. `partial` means some work landed and some didn't. */
export type ScheduledRunStatus = "ok" | "partial" | "failed";

/**
 * The stored record of a job's last run.
 *
 * `status` is optional because the row is written when a run *starts*: a process
 * killed mid-pass leaves the outcome unknown rather than claiming success. The
 * UI reads an absent status as "interrupted", never as "ok".
 */
export interface ScheduledRun {
  jobKey: string;
  /** When the run started, as a SQLite-style UTC timestamp. */
  lastRunAt: string;
  status?: ScheduledRunStatus;
  /** One human-readable line for the admin screen, e.g. "38 priced, 1 failed". */
  detail?: string;
}

/**
 * Every job key that exists, and the single source of the strings written to
 * `sys_scheduled_runs.job_key`.
 *
 * `stock_auto_refresh` is spelled exactly as migrations/0061 and the pre-existing
 * `STOCK_AUTO_REFRESH_JOB_KEY` spelled it -- renaming it would orphan the row
 * every existing install already has.
 */
export const JOB_KEYS = {
  stockAutoRefresh: "stock_auto_refresh",
  expenseAutoImport: "expense_auto_import",
  authEventPrune: "auth_event_prune",
} as const;

export type JobKey = (typeof JOB_KEYS)[keyof typeof JOB_KEYS];

/**
 * What the admin screen needs to describe a job without knowing anything about it.
 *
 * Adding a fourth background job means adding one entry here -- the page, the CLI
 * and the use-case all iterate this list rather than hard-coding three jobs.
 */
export interface JobDescriptor {
  key: JobKey;
  /** Title on the admin card. */
  label: string;
  /** One or two sentences: what a pass actually does. */
  description: string;
  /**
   * Whether an admin can trigger a pass on demand.
   *
   * False for the auth-event prune, deliberately: a pass *deletes* sign-in history
   * past the retention window, and unlike an import or a price refresh there is no
   * diagnostic reason to force one -- you can't inspect what it produced. Observing
   * its last run is the whole requirement.
   */
  runnable: boolean;
  /**
   * Whether the job's switch and cadence are user-editable on the admin screen.
   * False for the prune, whose 90-day window is fixed in code.
   */
  configurable: boolean;
}

/** The catalogue, in the order the admin screen lists it. */
export const JOB_DESCRIPTORS: readonly JobDescriptor[] = [
  {
    key: JOB_KEYS.stockAutoRefresh,
    label: "Stocks & ETFs auto refresh",
    description:
      "Prices every position, looks up the sector of any new ticker, then files the day's totals — exactly what the Refresh All button does, so the value history has no gaps on days nobody pressed it.",
    runnable: true,
    configurable: true,
  },
  {
    key: JOB_KEYS.expenseAutoImport,
    label: "Expense CSV auto-import",
    description:
      "Scans the watched folder for statement CSVs, imports each into the account named by its sub-folder, then renames the file so nothing is imported twice.",
    runnable: true,
    configurable: true,
  },
  {
    key: JOB_KEYS.authEventPrune,
    label: "Sign-in history prune",
    description:
      "Deletes sign-in and failed-login events past their 90-day retention window. Runs once a day; the window is fixed in code, so there is nothing to configure.",
    runnable: false,
    configurable: false,
  },
];

/**
 * A job as the admin screen sees it: what it is, plus what the table says about
 * its last run. Everything about *whether it is armed* stays with the module that
 * owns the switch -- this type deliberately carries no settings.
 */
export interface ScheduledJobView {
  descriptor: JobDescriptor;
  /** Undefined when the job has never run, which the screen states explicitly. */
  lastRun?: ScheduledRun;
}
