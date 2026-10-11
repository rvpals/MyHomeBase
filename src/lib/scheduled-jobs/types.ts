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
  siteVisitPrune: "site_visit_prune",
  dataBackup: "data_backup",
  helloWorld: "hello_world",
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
    label: "Investments auto refresh",
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
  {
    key: JOB_KEYS.dataBackup,
    label: "Data backup",
    description:
      "Copies attachment files that have changed into the attachment backup folder, setting any older copy aside first, then writes a compressed archive of the database and deletes the oldest archives past the keep count.",
    runnable: true,
    configurable: true,
  },
  {
    key: JOB_KEYS.helloWorld,
    label: "Hello, world!",
    description:
      "Files the configured message into the message queue each time it runs, so the unread badge in the header moves whenever the scheduler fires. It exists to prove the scheduler is alive on this install — every other job is silent when it has nothing to do, which makes a stopped scheduler look exactly like an idle one.",
    runnable: true,
    configurable: true,
  },
  {
    key: JOB_KEYS.siteVisitPrune,
    label: "Site visit history prune",
    description:
      "Deletes logged-out arrivals at the site root past their 90-day retention window. Runs once a day; the window is fixed in code, so there is nothing to configure.",
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

/**
 * One recorded pass, from `sys_scheduled_run_history` (migrations/0135).
 *
 * `finishedAt` and `status` are absent together and mean the pass started but never
 * finished -- the process was killed mid-pass, or a deploy cycled the server while
 * it was working. Reporting that honestly is the whole reason both are nullable.
 */
export interface ScheduledRunHistoryEntry {
  id: number;
  jobKey: string;
  /** SQLite-style UTC timestamp. */
  startedAt: string;
  finishedAt?: string;
  status?: ScheduledRunStatus;
  detail?: string;
}

/**
 * How many passes are kept per job. Pruned on every insert.
 *
 * 50 is a few days of an hourly job and months of a daily one, and across five jobs
 * it is ~250 rows -- nothing against a database already past 100 MB.
 */
export const HISTORY_LIMIT_PER_JOB = 50;

/**
 * One history row as the dialog renders it: the stored facts plus the two things
 * only a reader wants, computed rather than stored.
 */
export interface ScheduledRunHistoryView {
  id: number;
  startedAt: string;
  /** `undefined` when the pass never finished. */
  finishedAt?: string;
  /** Milliseconds from start to finish, or `undefined` when it never finished. */
  durationMs?: number;
  /** `"interrupted"` where the stored status is absent -- never `"ok"`. */
  status: ScheduledRunStatus | "interrupted";
  detail?: string;
}

/**
 * Why a job is not currently running, for the Inactive Tasks tab.
 *
 * Split from a plain boolean because "switched off" and "switched on but missing a
 * folder" are different problems with different fixes, and a reader looking at an
 * idle job needs to be told which one they have.
 */
export interface InactiveTaskRow {
  key: JobKey;
  label: string;
  /** One sentence naming what is missing or switched off. */
  reason: string;
  /** Undefined when the job has never run. */
  lastRunAt?: string;
  status: ScheduledRunStatus | "interrupted" | "never";
  detail?: string;
}

/**
 * When a job is expected to run next.
 *
 * Three shapes rather than one nullable timestamp, because the three cases read
 * differently to someone trying to work out whether a job is stuck:
 *
 *   * `at`      -- a real due time, computed from the last run plus the cadence.
 *   * `within`  -- the window the run falls in, with no exact time available.
 *                  The two prunes sit on a fixed 24h `setInterval` that is rearmed
 *                  from zero on every boot, and nothing persists when that happened.
 *                  On a NAS that restarts several times an hour, `lastRun + 24h`
 *                  would read as precise while being routinely wrong, so the window
 *                  is stated honestly instead.
 *   * `pending` -- armed but never run, so the next heartbeat runs it.
 */
export type NextRun =
  | { kind: "at"; atMs: number }
  | { kind: "within"; windowMs: number; fromMs: number }
  | { kind: "pending" };

/**
 * One row of the Active Tasks card: a job that is currently armed, and the four
 * facts the card shows about it.
 *
 * Only armed jobs become rows -- a switched-off job is not an active task, so it
 * is absent rather than listed as idle. `status` is the *last run's* outcome, not
 * a live indicator: nothing in the app tracks in-flight state, and `sys_scheduled_runs`
 * holds one row per job written at start and updated at finish.
 */
export interface ActiveTaskRow {
  key: JobKey;
  /** The job's catalogue label, so the card and the per-job card below agree. */
  label: string;
  nextRun: NextRun;
  /** Undefined when the job has never run. */
  lastRunAt?: string;
  /** Absent `status` on a stored run means the process died mid-pass. */
  status: ScheduledRunStatus | "interrupted" | "never";
  /** The stored one-liner, e.g. "38 priced, 1 failed". */
  detail?: string;
}
