"use client";

// The auto-refresh card on the Configuration section: the master switch, the
// interval it runs on, what the last run did, and a "Run now" escape hatch.
//
// Deliberately mirrors the Expense module's auto-import settings, which is the
// app's other user-configurable background job — same switch-then-interval
// ordering, same "background service: on/off" status line, same note that a
// change takes effect within a minute without a restart. Two schedulers that
// look and read alike are two schedulers a user only has to learn once.
//
// Narrow screens: every control here is full-width in a single column at both
// widths, so there is nothing to restyle -- the interval select is capped at
// `sm:max-w-xs` so it doesn't stretch absurdly wide on a desktop, which is a
// max-width and cannot regress the narrow layout.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
// Straight from `types`, not from the module index: the index re-exports the
// Sqlite repository and the `deps`-backed runner, and pulling those into a client
// component drags better-sqlite3 into the browser bundle and breaks the build.
import {
  REFRESH_INTERVALS,
  REFRESH_INTERVAL_LABELS,
  type RefreshInterval,
  type ScheduledRefreshSettings,
  type ScheduledRefreshSummary,
  type ScheduledRun,
} from "@/lib/scheduled-refresh/types";
import {
  runAutoRefreshNowAction,
  saveAutoRefreshSettingsAction,
} from "./stock-auto-refresh-actions";

const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function StockAutoRefreshCard({
  settings,
  lastRun,
}: {
  settings: ScheduledRefreshSettings;
  lastRun?: ScheduledRun;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(settings.autoRefreshEnabled);
  const [interval, setInterval] = useState<RefreshInterval>(settings.autoRefreshInterval);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [ranSummary, setRanSummary] = useState<ScheduledRefreshSummary | undefined>(undefined);

  const isDirty =
    enabled !== settings.autoRefreshEnabled || interval !== settings.autoRefreshInterval;

  async function handleSave() {
    setIsSaving(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await saveAutoRefreshSettingsAction({
        autoRefreshEnabled: enabled,
        autoRefreshInterval: interval,
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to save the auto-refresh settings.");
        return;
      }
      setMessage("Auto-refresh settings saved.");
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRunNow() {
    setIsRunning(true);
    setError(undefined);
    setMessage(undefined);
    setRanSummary(undefined);
    try {
      const result = await runAutoRefreshNowAction();
      if (!result.ok) {
        setError(result.error ?? "Failed to run the refresh.");
        return;
      }
      setRanSummary(result.summary);
      router.refresh();
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <CollapsibleCard title="Auto refresh on schedule">
      <p className="text-sm text-muted">
        Lets the server refresh everything on a schedule, so the value history has no gaps on
        days nobody pressed Refresh All. Each run prices every position, looks up the sector of
        any new ticker, then files the day&apos;s totals — exactly what the Refresh All button
        does.
      </p>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {message && <p className="mt-3 text-sm text-emerald-400">{message}</p>}

      <label className="mt-4 flex items-start gap-3 rounded-md border border-line bg-paper p-3 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-line text-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
        />
        <span>
          <span className="block font-medium text-ink">Auto refresh on schedule</span>
          <span className="mt-1 block text-xs text-muted">
            Allow background to refresh all on a schedule. Off means the server never refreshes
            on its own, whatever the interval says — <strong className="text-ink">Run refresh
            now</strong> still works, so you can try a pass before switching this on.
          </span>
        </span>
      </label>

      <div className="mt-4">
        <label className="block text-sm sm:max-w-xs">
          <span className="mb-1 block font-medium text-ink">Interval</span>
          <select
            value={interval}
            onChange={(event) => setInterval(event.target.value as RefreshInterval)}
            disabled={!enabled}
            className={`${INPUT_CLASS} disabled:opacity-50`}
          >
            {REFRESH_INTERVALS.map((option) => (
              <option key={option} value={option}>
                {REFRESH_INTERVAL_LABELS[option]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">
            {enabled
              ? "How often a pass runs, counted from the end of the last one."
              : "Switch auto refresh on to choose an interval."}
          </span>
        </label>
      </div>

      <p className="mt-4 text-xs text-muted">
        Background service:{" "}
        {enabled ? (
          <span className="text-emerald-400">
            on — {REFRESH_INTERVAL_LABELS[interval].toLowerCase()}, checked once a minute
          </span>
        ) : (
          <span className="text-muted">off — switched off above</span>
        )}
        . Takes effect within a minute of saving; no restart needed.
      </p>

      {lastRun && (
        <p className="mt-2 text-xs text-muted">
          Last run {lastRun.lastRunAt}
          {lastRun.status ? ` — ${lastRun.status}` : " — still running, or interrupted"}
          {lastRun.detail ? ` (${lastRun.detail})` : ""}.
        </p>
      )}

      {ranSummary && (
        <p
          className={`mt-2 text-sm ${
            ranSummary.status === "failed" ? "text-red-400" : "text-emerald-400"
          }`}
        >
          {ranSummary.ran ? ranSummary.detail : `Nothing ran: ${ranSummary.reason}`}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={handleSave} disabled={isSaving || !isDirty}>
          {isSaving ? "Saving…" : "Save settings"}
        </Button>
        <Button variant="secondary" onClick={handleRunNow} disabled={isRunning}>
          {isRunning ? "Refreshing…" : "Run refresh now"}
        </Button>
      </div>
    </CollapsibleCard>
  );
}
