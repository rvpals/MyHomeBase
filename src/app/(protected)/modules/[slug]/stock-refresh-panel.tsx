"use client";

// The dashboard's Refresh All button and its progress log.
//
// It walks the positions one at a time from the client rather than calling a
// single refresh-everything action, because a server action returns once and so
// can't report progress. One round trip per ticker sounds wasteful but isn't: the
// upstream quote fetch dominates, and there's exactly one of those per ticker
// either way. What it buys is a live line per symbol as the price lands.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { formatCents } from "@/lib/shared/money";
import {
  listRefreshTargetsAction,
  refreshOnePositionAction,
} from "./stock-positions-actions";
import { captureDailySnapshotAction } from "./stock-snapshot-actions";

interface LogLine {
  ticker: string;
  text: string;
  failed: boolean;
}

export function StockRefreshPanel({ lastSnapshotDate }: { lastSnapshotDate?: string }) {
  const router = useRouter();
  // Collapsed by default — the card is a control, not something you read. It opens
  // itself when a run starts, or the progress and result would land out of sight.
  const [isOpen, setIsOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [log, setLog] = useState<LogLine[]>([]);
  const [done, setDone] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  async function handleRefreshAll() {
    setIsOpen(true);
    setIsRunning(true);
    setLog([]);
    setDone(undefined);
    setError(undefined);
    setStatus("Reading positions…");

    try {
      const targets = await listRefreshTargetsAction();
      if (targets.length === 0) {
        setStatus(undefined);
        setError("No positions to refresh — add one first, or import a positions CSV.");
        return;
      }

      setProgress({ current: 0, total: targets.length });
      let failedCount = 0;

      for (const [index, target] of targets.entries()) {
        setStatus(`Getting price for ${target.ticker}…`);
        setProgress({ current: index, total: targets.length });

        const result = await refreshOnePositionAction(target.accountId, target.ticker);
        if (result.ok) {
          setLog((current) => [
            ...current,
            { ticker: result.ticker, text: `today's price is $${result.price}`, failed: false },
          ]);
        } else {
          failedCount += 1;
          setLog((current) => [
            ...current,
            { ticker: result.ticker, text: result.error ?? "failed", failed: true },
          ]);
        }
        setProgress({ current: index + 1, total: targets.length });
      }

      // One row per day: this replaces today's snapshot if the button was already
      // pressed today, and inserts if it wasn't.
      setStatus("Saving today's snapshot…");
      const captured = await captureDailySnapshotAction();
      if (!captured.ok || !captured.snapshot) {
        setError(captured.error ?? "Prices refreshed, but today's snapshot could not be saved.");
        return;
      }

      const snapshot = captured.snapshot;
      setDone(
        `Stock ${formatCents(snapshot.stockValueCents)} · ETF ${formatCents(snapshot.etfValueCents)}` +
          (snapshot.otherValueCents > 0 ? ` · Other ${formatCents(snapshot.otherValueCents)}` : "") +
          ` · Total ${formatCents(snapshot.totalValueCents)}` +
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
    <CollapsibleCard
      title="Refresh & snapshot"
      open={isOpen}
      onOpenChange={setIsOpen}
      headerAction={
        <Button size="sm" onClick={handleRefreshAll} disabled={isRunning}>
          {isRunning ? "Refreshing…" : "Refresh All"}
        </Button>
      }
    >
      <p className="text-sm text-muted">
        Fetches a live price for every position, then files today&apos;s totals in the history.
        Running it again today updates today&apos;s row rather than adding a second one.
        {lastSnapshotDate ? ` Last captured ${lastSnapshotDate}.` : " Nothing captured yet."}
      </p>

      {(isRunning || log.length > 0) && (
        <div className="mt-4">
          <div className="flex items-center gap-3">
            {/* aria-live so a screen reader hears each ticker, not just sighted users. */}
            <p className="min-w-0 flex-1 truncate text-sm text-ink" aria-live="polite">
              {status ?? "Done."}
            </p>
            <span className="shrink-0 font-mono text-xs text-muted">
              {progress.current}/{progress.total}
            </span>
          </div>

          <div
            className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line"
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

          {log.length > 0 && (
            /* Exactly five lines tall: `leading-5` pins each row at 1.25rem and no
               gap between them, so 5 × 1.25rem = 6.25rem shows five and scrolls the
               rest. Stated in rem rather than a `max-h-*` step so the arithmetic is
               checkable. */
            <ul className="mt-3 max-h-[6.25rem] overflow-y-auto font-mono text-xs">
              {log.map((line, index) => (
                <li
                  key={`${line.ticker}-${index}`}
                  className={`truncate leading-5 ${line.failed ? "text-red-400" : "text-muted"}`}
                >
                  <span className="text-ink">{line.ticker}</span> — {line.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {done && <p className="mt-3 text-sm text-emerald-400">{done}</p>}
    </CollapsibleCard>
  );
}
