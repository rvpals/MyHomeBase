"use client";

// The Background Tasks screen: Scheduled Tasks (what is armed, what ran) above a
// Configuration card holding one card per job, in catalogue order.
//
// The per-job cards are grouped rather than stacked flat so the top of the screen is
// the two things a reader came for — is anything running, and did it work — instead
// of five settings forms to scroll past. One level of nesting, which is the limit
// `components.md` sets on CollapsibleCard.
//
// Why the switches are here and not on each module's own settings screen: arming a
// background service is administration, and having three of them in three places is
// how you end up unable to answer "is anything running?". What stays with the module
// is the job's *configuration* — the Expense watched folder is what to import, not
// when — so each card shows those preconditions read-only, with a link to where they
// are edited. That matters because `isAutoImportEnabled` is `switch && folder &&
// interval`: without the folder shown here, you could switch the job on and watch
// nothing happen with no visible reason why.
//
// Narrow screens: every card is a single column at both widths, and the only
// multi-column element is capped with `sm:max-w-xs` (a max-width, which cannot
// regress the narrow layout). Nothing here needed a `max-lg:` override.

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Modal } from "@/components/modal";
import { Tabs } from "@/components/tabs";
import { UtcTime } from "@/components/utc-time";
// Types only, straight from the type modules rather than the lib indexes: those
// indexes re-export SQLite repositories, and pulling one into a client component
// drags better-sqlite3 into the browser bundle and breaks the build.
import {
  type BackupSettings,
} from "@/lib/backup/types";
import type { ExpenseSettings } from "@/lib/expense/settings";
// Types and the pure label/unit tables only — never the lib index, which
// re-exports a runner that reaches into the composition root.
import {
  INTERVAL_UNIT_LABELS,
  INTERVAL_UNITS,
  runsPerDay,
  unitToMinutes,
  type HelloWorldSettings,
  type IntervalUnit,
} from "@/lib/hello-world/types";
// Straight from the leaf modules, not the lib index: that index re-exports
// `SqliteScheduledRunRepository`, and pulling it into a client component drags
// better-sqlite3 into the browser bundle. `history.ts` is pure, so it is safe here.
import { describeDuration } from "@/lib/scheduled-jobs/history";
import { formatUtcStamp } from "@/lib/shared/utc-display";
import {
  JOB_KEYS,
  type ActiveTaskRow,
  type InactiveTaskRow,
  type NextRun,
  type ScheduledJobView,
  type ScheduledRun,
  type ScheduledRunHistoryView,
} from "@/lib/scheduled-jobs/types";
import {
  REFRESH_INTERVALS,
  REFRESH_INTERVAL_LABELS,
  type RefreshInterval,
  type ScheduledRefreshSettings,
} from "@/lib/scheduled-refresh/types";
import {
  loadRunHistoryAction,
  runAutoImportNowAction,
  runAutoRefreshNowAction,
  runDataBackupNowAction,
  runHelloWorldNowAction,
  saveAutoImportScheduleAction,
  saveAutoRefreshSettingsAction,
  saveBackupScheduleAction,
  saveHelloWorldSettingsAction,
} from "./actions";
import { PAGE_CONTAINER } from "../../page-container";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const CHECKBOX_CLASS =
  "mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export interface BackgroundTasksViewProps {
  jobs: ScheduledJobView[];
  /** The armed jobs only, already decided by `listActiveTasks` on the server. */
  activeTasks: ActiveTaskRow[];
  /** The complement: every job that is not armed, with why. */
  inactiveTasks: InactiveTaskRow[];
  autoRefresh: ScheduledRefreshSettings;
  expense: ExpenseSettings;
  backup: BackupSettings;
  helloWorld: HelloWorldSettings;
}

/**
 * The last-run line, which is the whole point of the screen.
 *
 * An absent status with a timestamp present means the process died between the
 * start stamp and the finish write, and it says so — claiming "ok" there would be
 * the worst possible lie for a screen whose only job is telling you what happened.
 */
function LastRun({ run }: { run?: ScheduledRun }) {
  if (!run) {
    return (
      <p className="text-sm text-muted">
        <span className="font-medium text-ink">Never run.</span> Nothing has been recorded for
        this job yet.
      </p>
    );
  }

  // Red means error, green means fine — the fixed-colour exception in design.md.
  const tone =
    run.status === "failed"
      ? "text-red-300"
      : run.status === "ok"
        ? "text-emerald-300"
        : "text-amber-300";

  return (
    <div className="text-sm">
      <p className="text-muted">
        Last run <UtcTime stamp={run.lastRunAt} className="text-ink" /> —{" "}
        <span className={`font-semibold ${tone}`}>{run.status ?? "interrupted"}</span>
      </p>
      {run.detail && <p className="mt-1 text-xs text-muted">{run.detail}</p>}
      {!run.status && (
        <p className="mt-1 text-xs text-amber-300">
          The run was stamped but never finished — the server most likely restarted mid-pass.
        </p>
      )}
    </div>
  );
}

/**
 * How a next run reads on the Active Tasks card.
 *
 * The `within` case deliberately states a window rather than a time: the prunes'
 * 24h timer is rearmed from zero on every boot and nothing records when that was,
 * so a precise-looking time would routinely be wrong on a NAS that restarts often.
 */
function describeNextRun(next: NextRun): ReactNode {
  if (next.kind === "pending") return "On the next check";
  if (next.kind === "at") return <UtcTime stamp={formatUtcStamp(next.atMs)} />;
  return <>By <UtcTime stamp={formatUtcStamp(next.fromMs + next.windowMs)} /></>;
}

/**
 * One job's recorded passes.
 *
 * Loads on open rather than with the page: five jobs' histories are up to 250 rows
 * nobody is looking at, and the dialog is the only thing that wants them.
 */
function HistoryDialog({
  jobKey,
  label,
  onClose,
}: {
  jobKey: string;
  label: string;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<ScheduledRunHistoryView[]>();
  const [error, setError] = useState<string>();
  // One load, owned by the dialog — the same `useState` flag pattern as FolderBrowser
  // rather than a `useEffect`.
  const [requested, setRequested] = useState(false);

  if (!requested) {
    setRequested(true);
    void loadRunHistoryAction(jobKey).then((result) => {
      if (result.ok) setEntries(result.entries ?? []);
      else setError(result.error ?? "Could not read the run history.");
    });
  }

  return (
    <Modal
      title={`${label} — history`}
      description="The most recent runs, newest first."
      size="lg"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}

      {!error && entries === undefined && <p className="text-sm text-muted">Reading the log…</p>}

      {entries?.length === 0 && (
        <p className="text-sm text-muted">
          No runs recorded yet. History starts from this job&apos;s next run — nothing before
          the feature existed was kept.
        </p>
      )}

      {entries !== undefined && entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm max-lg:block">
            <thead className="max-lg:hidden">
              <tr className="border-b border-line text-left">
                <th className="py-2 pr-4 font-medium text-muted">Started</th>
                <th className="py-2 pr-4 font-medium text-muted">Finished</th>
                <th className="py-2 pr-4 font-medium text-muted">Took</th>
                <th className="py-2 font-medium text-muted">Status</th>
              </tr>
            </thead>
            <tbody className="max-lg:block">
              {entries.map((run) => (
                <tr
                  key={run.id}
                  className="border-b border-line/60 align-top last:border-b-0 max-lg:block max-lg:py-3"
                >
                  <td className="py-2 pr-4 text-ink max-lg:block max-lg:py-0 max-lg:text-xs">
                    <span className="hidden text-muted max-lg:mr-1 max-lg:inline">Started:</span>
                    <UtcTime stamp={run.startedAt} />
                  </td>
                  <td className="py-2 pr-4 text-ink max-lg:block max-lg:py-0 max-lg:text-xs">
                    <span className="hidden text-muted max-lg:mr-1 max-lg:inline">Finished:</span>
                    <UtcTime stamp={run.finishedAt} />
                  </td>
                  <td className="py-2 pr-4 text-ink max-lg:block max-lg:py-0 max-lg:text-xs">
                    <span className="hidden text-muted max-lg:mr-1 max-lg:inline">Took:</span>
                    {run.durationMs === undefined ? "—" : describeDuration(run.durationMs)}
                  </td>
                  <td className="py-2 max-lg:block max-lg:py-0 max-lg:text-xs">
                    <span className="hidden text-muted max-lg:mr-1 max-lg:inline">Status:</span>
                    <StatusTag status={run.status} />
                    {run.detail && <span className="block text-xs text-muted">{run.detail}</span>}
                    {run.status === "interrupted" && (
                      <span className="block text-xs text-amber-300">
                        Started but never finished — the server most likely restarted mid-pass.
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/** The one-word outcome of a row's last run, with the screen's usual colour rule. */
function StatusTag({
  status,
}: {
  // Widened to cover a history row too: that union has no `"never"` (a recorded pass
  // always happened), so this is a superset rather than a second component.
  status: ActiveTaskRow["status"] | ScheduledRunHistoryView["status"];
}) {
  // Red means error, green means fine — the fixed-colour exception in design.md.
  const tone =
    status === "failed"
      ? "text-red-300"
      : status === "ok"
        ? "text-emerald-300"
        : status === "never"
          ? "text-muted"
          : "text-amber-300";

  return <span className={`font-semibold ${tone}`}>{status === "never" ? "never run" : status}</span>;
}

/**
 * The Active Tasks card: every job that is armed right now, with its next run,
 * its last run and that run's outcome.
 *
 * A table on desktop, stacked label/value rows under 1024px — the one place on
 * this screen that needed a `max-lg:` treatment, since a four-column table is
 * unreadable on a phone. Restyled with `max-lg:` variants only, so the desktop
 * layout provably cannot regress.
 *
 * Armed-only is the point: a switched-off job is not an active task and is absent
 * rather than listed as idle. With both switches off this tab shows just the two
 * prunes, which is correct — they have no switch.
 */
function ActiveTasks({
  rows,
  onShowHistory,
}: {
  rows: ActiveTaskRow[];
  onShowHistory: (jobKey: string, label: string) => void;
}) {
  if (rows.length === 0) {
    // Not reachable while the prunes exist, but the tab must not render a bare
    // header if a future release makes every job switchable.
    return <p className="text-sm text-muted">Nothing is armed right now.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm max-lg:block">
        <thead className="max-lg:hidden">
          <tr className="border-b border-line text-left">
            <th className="py-2 pr-4 font-medium text-muted">Task</th>
            <th className="py-2 pr-4 font-medium text-muted">Next run</th>
            <th className="py-2 pr-4 font-medium text-muted">Last run</th>
            <th className="py-2 pr-4 font-medium text-muted">Status</th>
            <th className="py-2 font-medium text-muted">
              <span className="sr-only">History</span>
            </th>
          </tr>
        </thead>
        <tbody className="max-lg:block">
          {rows.map((row) => (
            <tr
              key={row.key}
              className="border-b border-line/60 align-top last:border-b-0 max-lg:block max-lg:py-3"
            >
              <td className="py-2 pr-4 font-medium text-ink max-lg:block max-lg:py-0">
                {row.label}
              </td>
              <td className="py-2 pr-4 text-ink max-lg:block max-lg:py-0 max-lg:text-xs">
                <span className="hidden text-muted max-lg:mr-1 max-lg:inline">Next run:</span>
                {describeNextRun(row.nextRun)}
              </td>
              <td className="py-2 pr-4 text-ink max-lg:block max-lg:py-0 max-lg:text-xs">
                <span className="hidden text-muted max-lg:mr-1 max-lg:inline">Last run:</span>
                <UtcTime stamp={row.lastRunAt} />
                {row.detail && (
                  <span className="block text-xs text-muted">{row.detail}</span>
                )}
              </td>
              <td className="py-2 pr-4 max-lg:block max-lg:py-0 max-lg:text-xs">
                <span className="hidden text-muted max-lg:mr-1 max-lg:inline">Status:</span>
                <StatusTag status={row.status} />
              </td>
              <td className="py-2 max-lg:block max-lg:pt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onShowHistory(row.key, row.label)}
                >
                  History
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The Inactive Tasks tab: every job that is NOT armed, and why.
 *
 * The reason column is the point of this tab. "Inactive" alone sends a reader to the
 * card below to work out what is missing; naming the switch or the empty folder here
 * is what makes the list actionable.
 */
function InactiveTasks({
  rows,
  onShowHistory,
}: {
  rows: InactiveTaskRow[];
  onShowHistory: (jobKey: string, label: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted">Every task is armed — nothing is sitting idle.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm max-lg:block">
        <thead className="max-lg:hidden">
          <tr className="border-b border-line text-left">
            <th className="py-2 pr-4 font-medium text-muted">Task</th>
            <th className="py-2 pr-4 font-medium text-muted">Why it is not running</th>
            <th className="py-2 pr-4 font-medium text-muted">Last run</th>
            <th className="py-2 font-medium text-muted">
              <span className="sr-only">History</span>
            </th>
          </tr>
        </thead>
        <tbody className="max-lg:block">
          {rows.map((row) => (
            <tr
              key={row.key}
              className="border-b border-line/60 align-top last:border-b-0 max-lg:block max-lg:py-3"
            >
              <td className="py-2 pr-4 font-medium text-ink max-lg:block max-lg:py-0">
                {row.label}
              </td>
              <td className="py-2 pr-4 text-amber-300 max-lg:block max-lg:py-0 max-lg:text-xs">
                {row.reason}
              </td>
              <td className="py-2 pr-4 text-ink max-lg:block max-lg:py-0 max-lg:text-xs">
                <span className="hidden text-muted max-lg:mr-1 max-lg:inline">Last run:</span>
                <UtcTime stamp={row.lastRunAt} fallback="never" />
                {row.lastRunAt && (
                  <span className="ml-1">
                    <StatusTag status={row.status} />
                  </span>
                )}
              </td>
              <td className="py-2 max-lg:block max-lg:pt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onShowHistory(row.key, row.label)}
                >
                  History
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A read-only precondition owned by another screen, with a link to it. */
function Precondition({
  label,
  value,
  missing,
  href,
  hrefLabel,
}: {
  label: string;
  value: string;
  missing: string;
  href: string;
  hrefLabel: string;
}) {
  return (
    <div className="rounded-md border border-line bg-paper p-3 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      {value ? (
        <p className="mt-1 break-all text-ink">{value}</p>
      ) : (
        <p className="mt-1 text-amber-300">{missing}</p>
      )}
      <Link href={href} className="mt-1 inline-block text-xs text-brass hover:underline">
        {hrefLabel}
      </Link>
    </div>
  );
}

export function BackgroundTasksView({
  jobs,
  activeTasks,
  inactiveTasks,
  autoRefresh,
  expense,
  backup,
  helloWorld,
}: BackgroundTasksViewProps) {
  const router = useRouter();

  const byKey = new Map(jobs.map((job) => [job.descriptor.key, job]));
  const stockJob = byKey.get(JOB_KEYS.stockAutoRefresh);
  const expenseJob = byKey.get(JOB_KEYS.expenseAutoImport);
  const pruneJob = byKey.get(JOB_KEYS.authEventPrune);
  const backupJob = byKey.get(JOB_KEYS.dataBackup);
  const helloJob = byKey.get(JOB_KEYS.helloWorld);

  // Both folders set is what makes the job runnable at all; the switch only decides
  // whether it runs *on its own*. Saying which is missing is the whole point of
  // showing the preconditions here rather than only on the configuration screen.
  const backupConfigured = backup.attachmentRoot !== "" && backup.documentRoot !== "" && backup.databaseRoot !== "";

  // Stocks refresh form state.
  const [refreshEnabled, setRefreshEnabled] = useState(autoRefresh.autoRefreshEnabled);
  const [refreshInterval, setRefreshInterval] = useState<RefreshInterval>(
    autoRefresh.autoRefreshInterval,
  );
  // Expense import form state. The interval is held as text, not a number, so a
  // half-typed value doesn't snap to 0 mid-keystroke.
  const [importEnabled, setImportEnabled] = useState(expense.autoImportEnabled);
  const [importIntervalText, setImportIntervalText] = useState(
    String(expense.autoImportIntervalMinutes),
  );

  // Hello, world! form state. The count is held as text for the same reason as the
  // import interval above: a half-typed value must not snap to a number mid-keystroke.
  const [helloEnabled, setHelloEnabled] = useState(helloWorld.enabled);
  const [helloMessage, setHelloMessage] = useState(helloWorld.message);
  const [helloCountText, setHelloCountText] = useState(String(helloWorld.intervalCount));
  const [helloUnit, setHelloUnit] = useState<IntervalUnit>(helloWorld.intervalUnit);

  // Data backup schedule state. The cadence is the same count + unit pair as
  // Hello, world! above — and held as text for the same reason — plus an anchor
  // time this job keeps and that one has no use for.
  const [backupEnabled, setBackupEnabled] = useState(backup.enabled);
  const [backupCountText, setBackupCountText] = useState(String(backup.intervalCount));
  const [backupUnit, setBackupUnit] = useState<IntervalUnit>(backup.intervalUnit);
  const [backupStartTime, setBackupStartTime] = useState(backup.startTime);

  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  // Which job's history dialog is open, if any. The dialog loads its own rows.
  const [history, setHistory] = useState<{ jobKey: string; label: string }>();

  function showHistory(jobKey: string, label: string) {
    setHistory({ jobKey, label });
  }

  const importIntervalMinutes = Number(importIntervalText);
  const importIntervalValid = Number.isFinite(importIntervalMinutes) && importIntervalMinutes >= 0;
  // The switch alone doesn't arm the importer — see the module comment.
  const importConfigured = expense.autoImportPath !== "" && importIntervalMinutes > 0;
  const importBlockedBecause =
    expense.autoImportPath === "" ? "no folder is set" : "the interval is 0";

  const refreshDirty =
    refreshEnabled !== autoRefresh.autoRefreshEnabled ||
    refreshInterval !== autoRefresh.autoRefreshInterval;
  const importDirty =
    importEnabled !== expense.autoImportEnabled ||
    importIntervalMinutes !== expense.autoImportIntervalMinutes;

  const helloCount = Number(helloCountText);
  // Mirrors `intervalCountSchema` so the button disables before the action refuses.
  // The schema is still the authority — this only avoids a pointless round trip.
  const helloCountValid = Number.isInteger(helloCount) && helloCount >= 1 && helloCount <= 1000;
  const helloMessageValid = helloMessage.trim() !== "";
  const helloDirty =
    helloEnabled !== helloWorld.enabled ||
    helloMessage !== helloWorld.message ||
    helloCount !== helloWorld.intervalCount ||
    helloUnit !== helloWorld.intervalUnit;
  // The 60s heartbeat is the floor, so a sub-minute cadence runs once a minute. Said
  // on the card rather than clamped on save — see migrations/0136.
  const helloSubMinute =
    helloCountValid && helloUnit === "second" && helloCount < 60;
  // Every run files a queue message and nothing prunes the queue on a timer, so the
  // daily cost of the chosen cadence is stated before the job is armed.
  const helloRunsPerDay = helloCountValid
    ? runsPerDay(helloCount * unitToMinutes(helloUnit))
    : undefined;

  const backupCount = Number(backupCountText);
  // Same mirror of `intervalCountSchema` as the Hello, world! count above: the
  // schema remains the authority, this only avoids a pointless round trip.
  const backupCountValid =
    Number.isInteger(backupCount) && backupCount >= 1 && backupCount <= 1000;
  // Mirrors `startTimeSchema`. An `<input type="time">` can be left empty, and an
  // empty anchor would be rejected server-side with a message about HH:MM.
  const backupStartTimeValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(backupStartTime);
  const backupScheduleDirty =
    backupEnabled !== backup.enabled ||
    backupCount !== backup.intervalCount ||
    backupUnit !== backup.intervalUnit ||
    backupStartTime !== backup.startTime;
  // The same 60s floor as Hello, world!. A sub-minute backup is a bad idea for
  // reasons unrelated to the heartbeat, but the card states what will happen
  // rather than silently refusing — see migrations/0138.
  const backupSubMinute = backupCountValid && backupUnit === "second" && backupCount < 60;

  /** Every action funnels through here so one place owns the busy/message/error dance. */
  async function run(
    key: string,
    action: () => Promise<{ ok: boolean; error?: string }>,
    successMessage: string,
  ) {
    setBusy(key);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "Something went wrong.");
        return;
      }
      setMessage(successMessage);
      router.refresh();
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className={PAGE_CONTAINER}>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Background Tasks</h1>
      <p className="mt-2 text-sm text-muted">
        Everything the server runs on a timer, whether it is armed, and when it last ran. Each
        job is checked once a minute, so a change here takes effect within a minute — no restart
        needed. Runs are recorded in the database, so a deploy or a crash no longer loses the
        history.
      </p>

      {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
      {message && <p className="mt-4 text-sm text-emerald-300">{message}</p>}

      {/* -------------------------------------------------------- Scheduled Tasks */}
      <div className="mt-6">
        <CollapsibleCard title="Scheduled Tasks" defaultOpen>
          <Tabs
            items={[
              {
                key: "active",
                label: `Active Tasks (${activeTasks.length})`,
                content: (
                  <>
                    <p className="text-sm text-muted">
                      Only the jobs that are armed right now. Status is the outcome of the
                      last run, not a live indicator.
                    </p>
                    <div className="mt-3">
                      <ActiveTasks rows={activeTasks} onShowHistory={showHistory} />
                    </div>
                  </>
                ),
              },
              {
                key: "inactive",
                label: `Inactive Tasks (${inactiveTasks.length})`,
                content: (
                  <>
                    <p className="text-sm text-muted">
                      Jobs that will not run as things stand — switched off, or switched on
                      but missing something they need. Each row says which.
                    </p>
                    <div className="mt-3">
                      <InactiveTasks rows={inactiveTasks} onShowHistory={showHistory} />
                    </div>
                  </>
                ),
              },
            ]}
          />
        </CollapsibleCard>
      </div>

      {/* --------------------------------------------------------- Configuration */}
      {/* One card per job, grouped under a single header so the top of the screen
          is the two things a reader came for — what is armed, and what ran — rather
          than five settings forms they have to scroll past.

          Nesting is one level deep, which is the limit `components.md` sets, and the
          parent is `defaultOpen` so each job's header is still one click away. */}
      <div className="mt-6">
        <CollapsibleCard title="Configuration" defaultOpen>
          <p className="text-sm text-muted">
            Each job&rsquo;s switch and cadence. Settings that belong to a module — the
            Expense watched folder, the backup folders — stay on that module&rsquo;s own
            screen and are shown here read-only, with a link.
          </p>

        {/* ---------------------------------------------------------------- Stocks */}
        {stockJob && (
          <div className="mt-6">
            <CollapsibleCard title={stockJob.descriptor.label}>
              <p className="text-sm text-muted">{stockJob.descriptor.description}</p>

              <label className="mt-4 flex items-start gap-3 rounded-md border border-line bg-paper p-3 text-sm">
                <input
                  type="checkbox"
                  checked={refreshEnabled}
                  onChange={(event) => setRefreshEnabled(event.target.checked)}
                  className={CHECKBOX_CLASS}
                />
                <span>
                  <span className="block font-medium text-ink">Run on a schedule</span>
                  <span className="mt-1 block text-xs text-muted">
                    Off means the server never refreshes on its own, whatever the interval says.{" "}
                    <strong className="text-ink">Run now</strong> still works, so you can try a
                    pass before switching this on.
                  </span>
                </span>
              </label>

              <label className="mt-4 block text-sm sm:max-w-xs">
                <span className="mb-1 block font-medium text-ink">Interval</span>
                <select
                  value={refreshInterval}
                  onChange={(event) => setRefreshInterval(event.target.value as RefreshInterval)}
                  disabled={!refreshEnabled}
                  className={`${INPUT_CLASS} disabled:opacity-50`}
                >
                  {REFRESH_INTERVALS.map((option) => (
                    <option key={option} value={option}>
                      {REFRESH_INTERVAL_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>

              <p className="mt-4 text-xs text-muted">
                Status:{" "}
                {refreshEnabled ? (
                  <span className="text-emerald-300">
                    armed — {REFRESH_INTERVAL_LABELS[refreshInterval].toLowerCase()}, checked once a
                    minute
                  </span>
                ) : (
                  <span className="text-muted">off</span>
                )}
                .
              </p>

              <div className="mt-3">
                <LastRun run={stockJob.lastRun} />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    run(
                      "save-refresh",
                      () =>
                        saveAutoRefreshSettingsAction({
                          autoRefreshEnabled: refreshEnabled,
                          autoRefreshInterval: refreshInterval,
                        }),
                      "Auto-refresh settings saved.",
                    )
                  }
                  disabled={busy !== undefined || !refreshDirty}
                >
                  {busy === "save-refresh" ? "Saving…" : "Save settings"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => run("run-refresh", runAutoRefreshNowAction, "Refresh pass finished.")}
                  disabled={busy !== undefined}
                >
                  {busy === "run-refresh" ? "Refreshing…" : "Run now"}
                </Button>
              </div>
            </CollapsibleCard>
          </div>
        )}

        {/* --------------------------------------------------------------- Expense */}
        {expenseJob && (
          <div className="mt-4">
            <CollapsibleCard title={expenseJob.descriptor.label}>
              <p className="text-sm text-muted">{expenseJob.descriptor.description}</p>

              <label className="mt-4 flex items-start gap-3 rounded-md border border-line bg-paper p-3 text-sm">
                <input
                  type="checkbox"
                  checked={importEnabled}
                  onChange={(event) => setImportEnabled(event.target.checked)}
                  className={CHECKBOX_CLASS}
                />
                <span>
                  <span className="block font-medium text-ink">Run on a schedule</span>
                  <span className="mt-1 block text-xs text-muted">
                    Off means the scheduler never imports, whatever the folder and interval say.{" "}
                    <strong className="text-ink">Run now</strong> still works.
                  </span>
                </span>
              </label>

              <label className="mt-4 block text-sm sm:max-w-xs">
                <span className="mb-1 block font-medium text-ink">Interval (minutes)</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={importIntervalText}
                  onChange={(event) => setImportIntervalText(event.target.value)}
                  disabled={!importEnabled}
                  className={`${INPUT_CLASS} disabled:opacity-50`}
                />
                <span className="mt-1 block text-xs text-muted">
                  0 stops the importer even with the switch on.
                </span>
              </label>

              {/* The precondition that lives on another screen. Without this, switching
                  the job on with no folder set would silently do nothing. */}
              <div className="mt-4">
                <Precondition
                  label="Watched folder"
                  value={expense.autoImportPath}
                  missing="No folder set — this job cannot run."
                  href="/modules/expense"
                  hrefLabel="Change in Expense → Settings"
                />
              </div>

              <p className="mt-4 text-xs text-muted">
                Status:{" "}
                {importEnabled && importConfigured ? (
                  <span className="text-emerald-300">
                    armed — every {importIntervalMinutes} minute(s), checked once a minute
                  </span>
                ) : importEnabled ? (
                  <span className="text-amber-300">
                    switched on, but {importBlockedBecause} — it will not run
                  </span>
                ) : (
                  <span className="text-muted">off</span>
                )}
                .
              </p>

              <div className="mt-3">
                <LastRun run={expenseJob.lastRun} />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    run(
                      "save-import",
                      () =>
                        saveAutoImportScheduleAction({
                          autoImportEnabled: importEnabled,
                          autoImportIntervalMinutes: importIntervalValid
                            ? Math.floor(importIntervalMinutes)
                            : 0,
                        }),
                      "Auto-import schedule saved.",
                    )
                  }
                  disabled={busy !== undefined || !importDirty || !importIntervalValid}
                >
                  {busy === "save-import" ? "Saving…" : "Save settings"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => run("run-import", runAutoImportNowAction, "Import pass finished.")}
                  disabled={busy !== undefined}
                >
                  {busy === "run-import" ? "Importing…" : "Run now"}
                </Button>
              </div>
            </CollapsibleCard>
          </div>
        )}

        {/* ------------------------------------------------------------ Data backup */}
        {backupJob && (
          <div className="mt-4">
            <CollapsibleCard title={backupJob.descriptor.label}>
              <p className="text-sm text-muted">{backupJob.descriptor.description}</p>

              <div className="mt-3">
                <LastRun run={backupJob.lastRun} />
              </div>

              {/* Both folders, read-only with a link — the same treatment the Expense
                  watched folder gets, and for the same reason: a switch armed with no
                  destination would otherwise do nothing with no visible cause. */}
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Precondition
                  label="Attachments backed up to"
                  value={backup.attachmentRoot}
                  missing="No folder set — the backup cannot run."
                  href="/admin/configuration/backup"
                  hrefLabel="Backup Data →"
                />
                <Precondition
                  label="Documents backed up to"
                  value={backup.documentRoot}
                  missing="No folder set — the backup cannot run."
                  href="/admin/configuration/backup"
                  hrefLabel="Backup Data →"
                />
                <Precondition
                  label="Database backed up to"
                  value={backup.databaseRoot}
                  missing="No folder set — the backup cannot run."
                  href="/admin/configuration/backup"
                  hrefLabel="Backup Data →"
                />
              </div>

              {/* The schedule, moved here from Backup Data so every job's switch is
                  in one place. The folders above stay there — what to back up is
                  the module's, when to back it up is administration's. */}
              <label className="mt-4 flex items-start gap-3 rounded-md border border-line bg-paper p-3 text-sm">
                <input
                  type="checkbox"
                  checked={backupEnabled}
                  onChange={(event) => setBackupEnabled(event.target.checked)}
                  className={CHECKBOX_CLASS}
                />
                <span>
                  <span className="block font-medium text-ink">Run on a schedule</span>
                  <span className="mt-1 block text-xs text-muted">
                    Off means the backup never runs on its own, whatever the interval
                    says. <strong className="text-ink">Run now</strong> still works.
                  </span>
                </span>
              </label>

              {/* The count and the unit are one control split in two, so they sit on
                  one row and wrap together on a narrow screen — the same pairing as
                  the Hello, world! cadence below. */}
              <div className="mt-4 block text-sm sm:max-w-xs">
                <span className="mb-1 block font-medium text-ink">Run every</span>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={backupCountText}
                    onChange={(event) => setBackupCountText(event.target.value)}
                    disabled={!backupEnabled}
                    aria-label="How many"
                    className={`${INPUT_CLASS} w-24 disabled:opacity-50`}
                  />
                  <select
                    value={backupUnit}
                    onChange={(event) => setBackupUnit(event.target.value as IntervalUnit)}
                    disabled={!backupEnabled}
                    aria-label="Interval unit"
                    className={`${INPUT_CLASS} disabled:opacity-50`}
                  >
                    {INTERVAL_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {INTERVAL_UNIT_LABELS[unit]}
                      </option>
                    ))}
                  </select>
                </div>
                {backupSubMinute && (
                  // The honest version of a setting the scheduler cannot honour. The
                  // value is saved as typed; this says what will actually happen.
                  <span className="mt-1 block text-xs text-amber-300">
                    The scheduler checks once a minute, so anything under a minute runs
                    once a minute. A backup this often is almost certainly not what you
                    want — each pass snapshots the database and writes an archive.
                  </span>
                )}
              </div>

              <label className="mt-4 block text-sm sm:max-w-xs">
                <span className="mb-1 block font-medium text-ink">Start at</span>
                <input
                  type="time"
                  value={backupStartTime}
                  onChange={(event) => setBackupStartTime(event.target.value)}
                  disabled={!backupEnabled}
                  className={`${INPUT_CLASS} disabled:opacity-50`}
                />
                <span className="mt-1 block text-xs text-muted">
                  The time of day the schedule is anchored to, in the server&rsquo;s local
                  time. It sets when the <em>first</em> run happens; after that the
                  interval is measured from the last run.
                </span>
              </label>

              <p className="mt-4 text-sm text-muted">
                {!backupConfigured ? (
                  <span className="text-amber-300">
                    Not configured: choose both folders on Backup Data before this can run.
                  </span>
                ) : backup.enabled ? (
                  <>
                    Armed — every {backup.intervalCount} {backup.intervalUnit}(s), anchored
                    to {backup.startTime}, keeping {backup.keepCount} archive(s).
                  </>
                ) : (
                  <>
                    Configured but switched off. &ldquo;Run now&rdquo; still works; turn the
                    schedule on above.
                  </>
                )}
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    run(
                      "save-backup",
                      () =>
                        saveBackupScheduleAction({
                          enabled: backupEnabled,
                          intervalCount: backupCount,
                          intervalUnit: backupUnit,
                          startTime: backupStartTime,
                        }),
                      "Backup schedule saved.",
                    )
                  }
                  disabled={
                    busy !== undefined ||
                    !backupScheduleDirty ||
                    !backupCountValid ||
                    !backupStartTimeValid
                  }
                >
                  {busy === "save-backup" ? "Saving…" : "Save settings"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    run("run-backup", runDataBackupNowAction, "Backup finished.")
                  }
                  // Disabled rather than left to fail: with no folder there is nothing
                  // this button could usefully do, and the warning above says why.
                  disabled={busy !== undefined || !backupConfigured}
                >
                  {busy === "run-backup" ? "Backing up…" : "Run now"}
                </Button>
                <Link
                  href="/admin/configuration/backup"
                  className="self-center text-xs text-brass hover:underline"
                >
                  Configure backup folders →
                </Link>
              </div>
            </CollapsibleCard>
          </div>
        )}

        {/* ----------------------------------------------------------------- Prune */}
        {pruneJob && (
          <div className="mt-4">
            <CollapsibleCard title={pruneJob.descriptor.label}>
              <p className="text-sm text-muted">{pruneJob.descriptor.description}</p>

              {/* Read-only on purpose: a pass deletes sign-in history past the window,
                  and unlike an import or a price refresh there is nothing to inspect
                  afterwards — so there is no diagnostic reason to force one.
                  `JOB_DESCRIPTORS` marks it `runnable: false`. */}
              <p className="mt-4 text-xs text-muted">
                Status: <span className="text-emerald-300">always armed — once a day</span>. There
                is no switch and no manual run: the retention window is fixed in code, and a pass
                only deletes.
              </p>

              <div className="mt-3">
                <LastRun run={pruneJob.lastRun} />
              </div>

              <p className="mt-4 text-xs text-muted">
                Events are visible until they age out —{" "}
                <Link href="/admin/security" className="text-brass hover:underline">
                  Security
                </Link>{" "}
                shows the log.
              </p>
            </CollapsibleCard>
          </div>
        )}

        {/* ---------------------------------------------------------- Hello, world! */}
        {helloJob && (
          <div className="mt-4">
            <CollapsibleCard title={helloJob.descriptor.label}>
              <p className="text-sm text-muted">{helloJob.descriptor.description}</p>

              <label className="mt-4 flex items-start gap-3 rounded-md border border-line bg-paper p-3 text-sm">
                <input
                  type="checkbox"
                  checked={helloEnabled}
                  onChange={(event) => setHelloEnabled(event.target.checked)}
                  className={CHECKBOX_CLASS}
                />
                <span>
                  <span className="block font-medium text-ink">Run on a schedule</span>
                  <span className="mt-1 block text-xs text-muted">
                    Off means the server never runs it on its own, whatever the interval
                    says. <strong className="text-ink">Run now</strong> still works.
                  </span>
                </span>
              </label>

              <label className="mt-4 block text-sm sm:max-w-xs">
                <span className="mb-1 block font-medium text-ink">Message</span>
                <input
                  type="text"
                  value={helloMessage}
                  onChange={(event) => setHelloMessage(event.target.value)}
                  maxLength={200}
                  className={INPUT_CLASS}
                />
                <span className="mt-1 block text-xs text-muted">
                  Filed into the message queue as the title of each run&rsquo;s message, so
                  the unread badge in the header moves every time the job fires.
                </span>
              </label>

              {/* The count and the unit are one control split in two, so they sit on one
                  row and wrap together on a narrow screen rather than stranding the
                  unit under a full-width number box. */}
              <div className="mt-4 block text-sm sm:max-w-xs">
                <span className="mb-1 block font-medium text-ink">Run every</span>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={helloCountText}
                    onChange={(event) => setHelloCountText(event.target.value)}
                    disabled={!helloEnabled}
                    aria-label="How many"
                    className={`${INPUT_CLASS} w-24 disabled:opacity-50`}
                  />
                  <select
                    value={helloUnit}
                    onChange={(event) => setHelloUnit(event.target.value as IntervalUnit)}
                    disabled={!helloEnabled}
                    aria-label="Interval unit"
                    className={`${INPUT_CLASS} disabled:opacity-50`}
                  >
                    {INTERVAL_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {INTERVAL_UNIT_LABELS[unit]}
                      </option>
                    ))}
                  </select>
                </div>
                {helloSubMinute && (
                  // The honest version of a setting the scheduler cannot honour. The
                  // value is saved as typed; this says what will actually happen.
                  <span className="mt-1 block text-xs text-amber-300">
                    The scheduler checks once a minute, so anything under a minute runs
                    once a minute.
                  </span>
                )}
                {helloRunsPerDay !== undefined && (
                  // Stated before the job is armed, because nothing prunes the queue
                  // on a timer — the only cleanup is the purge on Admin → Messages.
                  <span className="mt-1 block text-xs text-muted">
                    Every run files a message, so this cadence adds about{" "}
                    <strong className="text-ink">
                      {helloRunsPerDay.toLocaleString()} message
                      {helloRunsPerDay === 1 ? "" : "s"} a day
                    </strong>{" "}
                    to the queue. Nothing prunes it automatically —{" "}
                    <Link href="/admin/messages" className="text-brass hover:underline">
                      purge it on Messages
                    </Link>
                    .
                  </span>
                )}
              </div>

              <p className="mt-4 text-xs text-muted">
                Status:{" "}
                {helloEnabled ? (
                  <span className="text-emerald-300">
                    armed — every {helloWorld.intervalCount} {helloWorld.intervalUnit}(s),
                    checked once a minute
                  </span>
                ) : (
                  <span className="text-muted">off</span>
                )}
                .
              </p>

              <div className="mt-3">
                <LastRun run={helloJob.lastRun} />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    run(
                      "save-hello",
                      () =>
                        saveHelloWorldSettingsAction({
                          enabled: helloEnabled,
                          message: helloMessage.trim(),
                          intervalCount: helloCount,
                          intervalUnit: helloUnit,
                        }),
                      "Hello, world! settings saved.",
                    )
                  }
                  disabled={
                    busy !== undefined || !helloDirty || !helloCountValid || !helloMessageValid
                  }
                >
                  {busy === "save-hello" ? "Saving…" : "Save settings"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => run("run-hello", runHelloWorldNowAction, "Hello, world! ran.")}
                  disabled={busy !== undefined}
                >
                  {busy === "run-hello" ? "Running…" : "Run now"}
                </Button>
              </div>
            </CollapsibleCard>
          </div>
        )}
        </CollapsibleCard>
      </div>
      {/* ----------------------------------------------------- end Configuration */}

      {history && (
        <HistoryDialog
          // Keyed so switching jobs with a dialog already open remounts it and
          // reloads, rather than showing the previous job's rows under a new title.
          key={history.jobKey}
          jobKey={history.jobKey}
          label={history.label}
          onClose={() => setHistory(undefined)}
        />
      )}
    </div>
  );
}
