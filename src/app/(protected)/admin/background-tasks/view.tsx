"use client";

// The Background Tasks screen: one card per job, in catalogue order.
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

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
// Types only, straight from the type modules rather than the lib indexes: those
// indexes re-export SQLite repositories, and pulling one into a client component
// drags better-sqlite3 into the browser bundle and breaks the build.
import type { ExpenseSettings } from "@/lib/expense/settings";
import { JOB_KEYS, type ScheduledJobView, type ScheduledRun } from "@/lib/scheduled-jobs/types";
import {
  REFRESH_INTERVALS,
  REFRESH_INTERVAL_LABELS,
  type RefreshInterval,
  type ScheduledRefreshSettings,
} from "@/lib/scheduled-refresh/types";
import {
  runAutoImportNowAction,
  runAutoRefreshNowAction,
  saveAutoImportScheduleAction,
  saveAutoRefreshSettingsAction,
} from "./actions";
import { PAGE_CONTAINER } from "../../page-container";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

const CHECKBOX_CLASS =
  "mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export interface BackgroundTasksViewProps {
  jobs: ScheduledJobView[];
  autoRefresh: ScheduledRefreshSettings;
  expense: ExpenseSettings;
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
        Last run <span className="text-ink">{run.lastRunAt}</span> UTC —{" "}
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

export function BackgroundTasksView({ jobs, autoRefresh, expense }: BackgroundTasksViewProps) {
  const router = useRouter();

  const byKey = new Map(jobs.map((job) => [job.descriptor.key, job]));
  const stockJob = byKey.get(JOB_KEYS.stockAutoRefresh);
  const expenseJob = byKey.get(JOB_KEYS.expenseAutoImport);
  const pruneJob = byKey.get(JOB_KEYS.authEventPrune);

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

  const [busy, setBusy] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

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
    </div>
  );
}
