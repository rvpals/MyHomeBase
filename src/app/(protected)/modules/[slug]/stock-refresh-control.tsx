"use client";

// The dashboard's refresh control: an icon beside the "Dashboard" heading, the
// note that explains what it does, and the progress bar it drives.
//
// It walks the positions one at a time from the client rather than calling a
// single refresh-everything action, because a server action returns once and so
// can't report progress. One round trip per ticker sounds wasteful but isn't: the
// upstream quote fetch dominates, and there's exactly one of those per ticker
// either way. What it buys is a live line per symbol as the price lands.
//
// Replaced the "Refresh & snapshot" card. A collapsible card was a lot of
// furniture around one button, and being collapsed by default it hid the very
// control it existed to hold — so the button moved to the heading it acts on and
// the progress bar became a strip under the section divider.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { Comments } from "@/components/comments";
import { TreeIcon } from "@/components/tree-icons";
import { formatCents } from "@/lib/shared/money";
import {
  listRefreshTargetsAction,
  refreshOnePositionAction,
} from "./stock-positions-actions";
import { refreshTickerProfilesAction } from "./stock-profiles-actions";
import { captureDailySnapshotAction } from "./stock-snapshot-actions";

export function StockRefreshControl({ lastSnapshotDate }: { lastSnapshotDate?: string }) {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [done, setDone] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  async function handleRefreshAll() {
    setIsRunning(true);
    setDone(undefined);
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
      // Counted rather than listed per ticker: the old five-line log is gone, so
      // the closing line is the only place a failure can still be reported.
      let failedCount = 0;

      for (const [index, target] of targets.entries()) {
        setStatus(`getting price for ${target.ticker}…`);
        setProgress({ current: index, total: targets.length });

        const result = await refreshOnePositionAction(target.accountId, target.ticker);
        if (!result.ok) failedCount += 1;
        setProgress({ current: index + 1, total: targets.length });
      }

      // Sectors for the allocation chart. Skipped for every ticker already
      // cached, so after the first run this is usually instant — and it's one
      // call for the whole portfolio rather than one per symbol, because the
      // walk happens server-side where there's no progress to report.
      setStatus("looking up sectors…");
      const profiles = await refreshTickerProfilesAction();

      // One row per day: this replaces today's snapshot if the button was already
      // pressed today, and inserts if it wasn't.
      setStatus("saving today's snapshot…");
      const captured = await captureDailySnapshotAction();
      if (!captured.ok || !captured.snapshot) {
        setError(captured.error ?? "Prices refreshed, but today's snapshot could not be saved.");
        return;
      }

      const snapshot = captured.snapshot;
      // A sector lookup is a footnote, not an outcome: it's mentioned only when
      // it actually did something, and never when it found nothing new.
      const sectorNote = profiles.fetchedCount
        ? ` · ${profiles.fetchedCount} sector(s) looked up`
        : "";
      setDone(
        `Stock ${formatCents(snapshot.stockValueCents)} · ETF ${formatCents(snapshot.etfValueCents)}` +
          (snapshot.otherValueCents > 0 ? ` · Other ${formatCents(snapshot.otherValueCents)}` : "") +
          ` · Total ${formatCents(snapshot.totalValueCents)}` +
          sectorNote +
          (failedCount > 0 ? ` — ${failedCount} ticker(s) could not be priced` : ""),
      );
      router.refresh();
    } finally {
      setIsRunning(false);
      setStatus(undefined);
    }
  }

  const pct = progress.total === 0 ? 0 : Math.round((progress.current / progress.total) * 100);

  return (
    <>
      {/* Icon-only, so `title` and `ariaLabel` carry the whole meaning. Secondary
          rather than primary: it sits on a heading line, and the brass fill would
          make it the loudest thing on the screen. */}
      <Button
        size="sm"
        variant="secondary"
        onClick={handleRefreshAll}
        disabled={isRunning}
        title="Refresh all prices and capture today's snapshot"
        ariaLabel="Refresh all prices and capture today's snapshot"
        className="px-2"
      >
        <TreeIcon
          name="refresh"
          className={`h-4 w-4 ${isRunning ? "animate-spin motion-reduce:animate-none" : ""}`}
        />
      </Button>

      <Comments
        title="Note"
        content={
          <p>
            Fetches a live price for every position, looks up the sector of any new ticker, then
            files today&apos;s totals in the history. Running it again today updates today&apos;s
            row rather than adding a second one.
            {lastSnapshotDate ? ` Last captured ${lastSnapshotDate}.` : " Nothing captured yet."}
          </p>
        }
      />

      {/* `basis-full` breaks this onto its own line inside the heading's flex row,
          so the bar spans the width instead of competing with the title for it. */}
      {(isRunning || done || error) && (
        <div className="mt-2 basis-full">
          {(isRunning || progress.total > 0) && (
            <>
              <div className="flex items-center gap-3">
                {/* aria-live so a screen reader hears each ticker, not just sighted users. */}
                <p className="min-w-0 flex-1 truncate text-sm text-ink" aria-live="polite">
                  {status ?? "done."}
                </p>
                <span className="shrink-0 font-mono text-xs text-muted">
                  {progress.current}/{progress.total} · {pct}%
                </span>
              </div>

              <div
                className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Refresh progress"
              >
                <div
                  className="h-full rounded-full bg-brass transition-[width] motion-reduce:transition-none"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </>
          )}

          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          {done && <p className="mt-2 text-sm text-emerald-400">{done}</p>}
        </div>
      )}
    </>
  );
}
