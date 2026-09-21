"use client";

// "Create locations from existing journal entries": the modal behind the
// Location Manager's import button.
//
// Scans every coordinate already on an entry, groups the duplicates, and
// creates one library place per distinct point — taking the entry's own
// `place_name` as the description, and optionally looking the address up.
//
// Route-local rather than registered: only the Journal has a location library.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import { Progress3D } from "@/components/progress-3d";
import { GEOCODE_INTERVAL_MS } from "@/lib/journal-locations";
import {
  finishLocationImportAction,
  previewLocationImportAction,
  runLocationImportBatchAction,
} from "./journal-locations-actions";

/** "about 5 minutes" — the address pass is one lookup per second, so this is it. */
function formatEstimate(candidateCount: number): string {
  const seconds = Math.round((candidateCount * GEOCODE_INTERVAL_MS) / 1000);
  if (seconds < 90) return `about ${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = (minutes / 60).toFixed(1).replace(/\.0$/, "");
  return `about ${hours} hours`;
}

export function JournalLocationImportModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  // `undefined` while the first scan runs — the bar reads indeterminate then.
  const [candidateCount, setCandidateCount] = useState<number | undefined>(undefined);
  const [withAddresses, setWithAddresses] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  /**
   * Whether Stop has been pressed.
   *
   * A ref, not state: the batch loop below is one long-lived closure, and a
   * `useState` value captured when it started would never change under it — the
   * run would carry on to the end. The button also flips a state flag purely so
   * the label can re-render.
   */
  const stopRequested = useRef(false);
  const [isStopping, setIsStopping] = useState(false);

  const scan = useCallback(async () => {
    const result = await previewLocationImportAction();
    if (result.ok) {
      setCandidateCount(result.candidateCount ?? 0);
      setError(undefined);
    } else {
      setError(result.error);
    }
  }, []);

  // The scan runs once when the modal opens. Deferred by a timeout rather than
  // awaited straight in the effect body: `scan` sets state, and doing that
  // synchronously inside an effect cascades a render.
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled) void scan();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scan]);

  async function handleRun() {
    setError(undefined);
    setNotice(undefined);
    setDone(0);
    stopRequested.current = false;
    setIsStopping(false);
    setIsRunning(true);

    let stopped = false;
    let completed = 0;
    let createdSoFar = 0;
    let addressedSoFar = 0;

    try {
      // A batch at a time so the bar can move and a long address run can be
      // stopped. Each call recomputes what is outstanding, so this cannot skip
      // or double-create — see `runImportBatch`.
      for (;;) {
        const result = await runLocationImportBatchAction(withAddresses);
        if (!result.ok || !result.result) {
          setError(result.error ?? "The import failed.");
          return;
        }

        const batch = result.result;
        completed += batch.processedCount;
        createdSoFar += batch.createdCount;
        addressedSoFar += batch.addressCount;
        setDone(completed);

        // processedCount of 0 means nothing is left — stop rather than spin.
        if (batch.remainingCount === 0 || batch.processedCount === 0) break;

        if (stopRequested.current) {
          stopped = true;
          break;
        }
      }

      const addressLine = withAddresses
        ? ` ${addressedSoFar} got an address.`
        : "";
      setNotice(
        stopped
          ? `Stopped. ${createdSoFar} location${createdSoFar === 1 ? "" : "s"} created so far — run it again to carry on.${addressLine}`
          : `Done. Created ${createdSoFar} location${createdSoFar === 1 ? "" : "s"}.${addressLine}`,
      );
      await finishLocationImportAction();
      await scan();
      router.refresh();
    } finally {
      setIsRunning(false);
    }
  }

  const total = candidateCount ?? 0;
  const hasNothingToDo = candidateCount === 0;

  return (
    <Modal
      onClose={onClose}
      isBusy={isRunning}
      size="md"
      title="Create locations from existing journal entries"
    >
      <div className="flex flex-col gap-3">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {notice && <p className="text-sm text-ink">{notice}</p>}

        {candidateCount === undefined ? (
          <p className="text-sm text-muted">Scanning your journal…</p>
        ) : hasNothingToDo ? (
          <p className="text-sm text-muted">
            Every coordinate in your journal is already in the location library. Nothing to
            import.
          </p>
        ) : (
          <p className="text-sm text-muted">
            Found <span className="font-medium text-ink">{total}</span> distinct{" "}
            {total === 1 ? "place" : "places"} across your journal entries that{" "}
            {total === 1 ? "isn't" : "aren't"} in the library yet. Repeated coordinates are
            grouped into one, and each entry&apos;s <em>place name</em> becomes the
            description.
          </p>
        )}

        {!hasNothingToDo && candidateCount !== undefined && (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={withAddresses}
              onChange={(event) => setWithAddresses(event.target.checked)}
              disabled={isRunning}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-ink">Look up each address</span>
              <span className="block text-xs text-muted">
                Uses OpenStreetMap, which allows one lookup a second — {formatEstimate(total)}{" "}
                for {total}. Without it the import is near-instant. A lookup that fails just
                leaves the address blank.
              </span>
            </span>
          </label>
        )}

        {(isRunning || done > 0) && (
          <Progress3D
            label="Importing"
            value={done}
            max={Math.max(total, done)}
            formatValue={() => `${done} of ${Math.max(total, done)} places`}
            showValue
          />
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleRun} disabled={isRunning || hasNothingToDo || candidateCount === undefined}>
            {isRunning ? "Importing…" : "Create the locations"}
          </Button>
          {isRunning && (
            <Button
              variant="secondary"
              onClick={() => {
                stopRequested.current = true;
                setIsStopping(true);
              }}
              disabled={isStopping}
            >
              {isStopping ? "Stopping…" : "Stop"}
            </Button>
          )}
          {!isRunning && (
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          )}
        </div>

        {isRunning && (
          <p className="text-xs text-muted">
            {isStopping
              ? "Finishing the batch in flight, then stopping."
              : "Stopping keeps everything created so far — running the import again picks up where it left off."}
          </p>
        )}
        <div className="sr-only" aria-live="polite">
          {isRunning ? `Imported ${done} of ${total} places` : (notice ?? "")}
        </div>
      </div>
    </Modal>
  );
}
