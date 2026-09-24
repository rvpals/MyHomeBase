"use client";

// The Daily Glance card's own refresh: the button that sits in the card header
// and the progress strip that appears in the card body while it runs.
//
// The same job as the dashboard's `StockRefreshControl` — re-price every
// position one at a time, look up any new sector, then file today's snapshot —
// and it calls the very same server actions. It is a separate file rather than a
// reuse of that component because the two differ in where their parts render:
// the dashboard's button and bar are siblings on a heading line, while these
// straddle the card's header and body. A shared component would have to take the
// header and body as slots, which is more machinery than the ~40 lines it saves.
//
// Walked one ticker at a time from the client for the reason given in
// `stock-refresh-control.tsx`: a server action returns once and so cannot report
// progress. The extra round trips are not the cost — the upstream quote fetch is,
// and there is exactly one of those per ticker either way.
//
// Authorisation is unchanged: every action below authorises on
// `requireModuleAccess("investments")`, and this card only renders for a reader
// who already has that module (see the home page's `stockModule` gate), so
// nothing here widens anyone's reach.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { Progress3D } from "@/components/progress-3d";
import { TreeIcon } from "@/components/tree-icons";
import {
  listRefreshTargetsAction,
  refreshOnePositionAction,
} from "./stock-positions-actions";
import { refreshTickerProfilesAction } from "./stock-profiles-actions";
import { captureDailySnapshotAction } from "./stock-snapshot-actions";
import { runMonitorsAgainstMyTickerAction } from "./ticker-monitors-actions";

export interface GlanceRefreshState {
  isRunning: boolean;
  /** What the run is doing right now, e.g. "getting price for AAPL…". */
  status?: string;
  error?: string;
  progress: { current: number; total: number };
  start: () => void;
}

/**
 * Drives one refresh run. Returned rather than rendered so the card can put the
 * button in its header and the bar in its body while both read one state.
 */
export function useGlanceRefresh(): GlanceRefreshState {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  async function start() {
    setIsRunning(true);
    setError(undefined);
    setProgress({ current: 0, total: 0 });
    setStatus("reading positions…");

    try {
      const targets = await listRefreshTargetsAction();
      if (targets.length === 0) {
        setError("No positions to refresh — add one first, or import a positions CSV.");
        return;
      }

      setProgress({ current: 0, total: targets.length });
      // Counted, not listed: this card has no room for a line per ticker, so the
      // count is the only place a failure gets reported.
      let failedCount = 0;

      for (const [index, target] of targets.entries()) {
        setStatus(`getting price for ${target.ticker}…`);
        setProgress({ current: index, total: targets.length });

        const result = await refreshOnePositionAction(target.accountId, target.ticker);
        if (!result.ok) failedCount += 1;
        setProgress({ current: index + 1, total: targets.length });
      }

      // One call for the whole portfolio, and a no-op for every ticker already
      // cached — so after the first run this is usually instant.
      setStatus("looking up sectors…");
      await refreshTickerProfilesAction();

      // Matches the dashboard button exactly. Safe to press repeatedly: this
      // replaces today's row rather than adding a second one.
      setStatus("saving today's snapshot…");
      const captured = await captureDailySnapshotAction();
      if (!captured.ok) {
        setError(captured.error ?? "Prices refreshed, but today's snapshot could not be saved.");
        return;
      }

      // Monitors, against the prices this run just wrote. Same step the
      // dashboard's control makes — this card is the home screen's copy of that
      // loop, so a monitor must fire the same way whichever button was pressed.
      //
      // Nothing is reported here: the card has no room for a line per outcome,
      // which is why `failedCount` below is a count rather than a list. The
      // triggered monitors land in the message queue, and the bell in the header
      // is what says so.
      setStatus("checking monitors…");
      await runMonitorsAgainstMyTickerAction();

      // A partial failure is worth saying even though the run finished: the
      // numbers below are now a mix of fresh and stale, and only this line says so.
      if (failedCount > 0) {
        setError(`${failedCount} ticker(s) could not be priced — their figures are unchanged.`);
      }

      // The card's figures are server-rendered props, so this is what actually
      // updates them — including the "Last refreshed on" line, which is derived
      // from the positions this run just wrote.
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The refresh could not be completed.");
    } finally {
      setIsRunning(false);
      setStatus(undefined);
    }
  }

  return { isRunning, status, error, progress, start };
}

/** The header button. Icon-only, so `title` and `ariaLabel` carry the meaning. */
export function GlanceRefreshButton({ state }: { state: GlanceRefreshState }) {
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={state.start}
      disabled={state.isRunning}
      title="Refresh all prices and capture today's snapshot"
      ariaLabel="Refresh all prices and capture today's snapshot"
      className="px-2"
    >
      <TreeIcon
        name="refresh"
        className={`h-4 w-4 ${state.isRunning ? "animate-spin motion-reduce:animate-none" : ""}`}
      />
    </Button>
  );
}

/**
 * The progress strip, shown in the card body only while a run is in flight or
 * after one has failed. Deliberately no success summary: the refreshed figures
 * are already the card's whole content, so a closing line restating them would
 * push the thing the reader came for further down the page.
 */
export function GlanceRefreshProgress({ state }: { state: GlanceRefreshState }) {
  const { isRunning, status, error, progress } = state;
  if (!isRunning && !error) return null;

  const pct = progress.total === 0 ? 0 : Math.round((progress.current / progress.total) * 100);

  return (
    <div className="mb-4">
      {isRunning && (
        <>
          <div className="flex items-center gap-3">
            {/* aria-live so a screen reader hears the run progress too. */}
            <p className="min-w-0 flex-1 truncate text-sm text-ink" aria-live="polite">
              {status ?? "working…"}
            </p>
            <span className="shrink-0 font-mono text-xs text-muted">
              {progress.current}/{progress.total} · {pct}%
            </span>
          </div>

          <Progress3D
            // Undefined until the total is known, so the bar goes indeterminate
            // rather than showing a misleading 0%.
            value={progress.total === 0 ? undefined : progress.current}
            max={progress.total}
            size="sm"
            ariaLabel="Portfolio refresh progress"
            className="mt-1.5"
          />
        </>
      )}

      {error && <p className={`text-sm text-red-400 ${isRunning ? "mt-2" : ""}`}>{error}</p>}
    </div>
  );
}
