"use client";

// The Scan Music screen: pick a folder, start a scan, watch it work.
//
// The progress display is the reason `mus_scan_runs` exists as a table. A scan of this
// library takes minutes to tens of minutes on the NAS, far longer than any request can
// stay open, so the action starts the work and returns; this view polls the run row for
// the percentage and the file currently being read. Because the progress lives in the
// database rather than in memory, a page refresh mid-scan picks straight back up -- and
// a scan started from the CLI shows here too.

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/button";
import {
  getScanStatusAction,
  listFoldersAction,
  listRecentScansAction,
  startScanAction,
  type ScanStatusView,
} from "./music-actions";

/** While a scan is live, ask this often. Fast enough to feel live, cheap enough to ignore. */
const POLL_INTERVAL_MS = 1000;

interface Folder {
  name: string;
  relativePath: string;
  hasChildren: boolean;
}

export function MusicScanView() {
  const [breadcrumb, setBreadcrumb] = useState<string[]>([]);
  const [tree, setTree] = useState<{ available: boolean; folders: Folder[] }>({
    available: true,
    folders: [],
  });
  const [selected, setSelected] = useState("");

  const folders = tree.folders;
  const available = tree.available;
  // One state object for the polled data, so a refresh is a single commit rather than
  // two setState calls the linter reads as cascading renders.
  const [progress, setProgress] = useState<{
    live: ScanStatusView | undefined;
    recent: ScanStatusView[];
  }>({ live: undefined, recent: [] });
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [isStarting, startScan] = useTransition();

  const status = progress.live;
  const recent = progress.recent;

  const currentFolder = breadcrumb.join("/");

  // Load the folder listing for wherever we are in the tree.
  useEffect(() => {
    let cancelled = false;
    void listFoldersAction(currentFolder).then((result) => {
      if (!cancelled) setTree({ available: result.available, folders: result.folders });
    });
    return () => {
      cancelled = true;
    };
  }, [currentFolder]);

  const refreshStatus = useCallback(async () => {
    const [live, recentRuns] = await Promise.all([
      getScanStatusAction(),
      listRecentScansAction(5),
    ]);
    setProgress({ live, recent: recentRuns });
  }, []);

  // Fetch once on mount. The setState happens in the promise callback, not in the
  // effect body -- the effect only starts the request.
  useEffect(() => {
    let cancelled = false;
    void Promise.all([getScanStatusAction(), listRecentScansAction(5)]).then(
      ([live, recentRuns]) => {
        if (!cancelled) setProgress({ live, recent: recentRuns });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll only while something is actually running -- no timer otherwise.
  const isRunning = status?.status === "running" && !status.isStale;
  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => void refreshStatus(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isRunning, refreshStatus]);

  const onStart = () => {
    setMessage(undefined);
    startScan(async () => {
      const result = await startScanAction({ folder: selected });
      if ("error" in result) setMessage(result.error);
      else await refreshStatus();
    });
  };

  if (!available) {
    return (
      <div className="rounded-xl border border-line p-6">
        <p className="text-sm text-ink">The music folder is not reachable.</p>
        <p className="mt-2 text-sm text-muted">
          Check that <span className="font-mono text-ink">MYHOMEBASE_MUSIC_ROOT</span> is set and
          that the NAS is awake.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section>
        <h2 className="font-display text-lg text-ink">Choose a folder</h2>
        <p className="mt-1 text-sm text-muted">
          Scanning one folder at a time is faster than the whole library, and it is how you
          leave out what you do not want catalogued.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => setBreadcrumb([])}
            className="rounded px-2 py-1 text-brass-dark hover:bg-brass-soft"
          >
            All music
          </button>
          {breadcrumb.map((segment, index) => (
            <span key={`${segment}-${index}`} className="flex items-center gap-1">
              <span className="text-muted">/</span>
              <button
                type="button"
                onClick={() => setBreadcrumb(breadcrumb.slice(0, index + 1))}
                className="rounded px-2 py-1 text-brass-dark hover:bg-brass-soft"
              >
                {segment}
              </button>
            </span>
          ))}
        </div>

        <div className="mt-2 rounded-xl border border-line">
          <label className="flex items-center gap-2 border-b border-line px-3 py-2">
            <input
              type="radio"
              name="scan-folder"
              checked={selected === currentFolder}
              onChange={() => setSelected(currentFolder)}
              className="accent-brass"
            />
            <span className="text-sm text-ink">
              {currentFolder === "" ? "Everything (all 12 top-level folders)" : currentFolder}
            </span>
          </label>

          {folders.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">No sub-folders here.</p>
          ) : (
            <ul className="max-h-72 divide-y divide-line overflow-y-auto">
              {folders.map((folder) => (
                <li key={folder.relativePath} className="flex items-center gap-2 px-3 py-2">
                  <input
                    type="radio"
                    name="scan-folder"
                    checked={selected === folder.relativePath}
                    onChange={() => setSelected(folder.relativePath)}
                    className="accent-brass"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{folder.name}</span>
                  {folder.hasChildren && (
                    <button
                      type="button"
                      onClick={() => setBreadcrumb([...breadcrumb, folder.name])}
                      className="rounded px-2 py-1 text-xs text-brass-dark hover:bg-brass-soft"
                    >
                      Open
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button onClick={onStart} disabled={isStarting || isRunning}>
            {isRunning ? "Scanning..." : isStarting ? "Starting..." : "Scan Music"}
          </Button>
          <span className="text-xs text-muted">
            {selected === "" ? "Everything" : selected}
          </span>
        </div>

        {message !== undefined && (
          <p className="mt-2 rounded border border-line bg-paper-raised p-2 text-xs text-muted">
            {message}
          </p>
        )}

        <p className="mt-3 text-xs text-muted">
          Formats come from Configuration. Files already catalogued and unchanged are skipped,
          so scanning again is quick.
        </p>
      </section>

      <section>
        <h2 className="font-display text-lg text-ink">Progress</h2>
        {status === undefined ? (
          <p className="mt-2 text-sm text-muted">No scans yet.</p>
        ) : (
          <ScanProgress status={status} />
        )}

        {recent.length > 0 && (
          <>
            <h3 className="mt-6 font-display text-sm text-ink">Recent scans</h3>
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line text-xs">
              {recent.map((run) => (
                <li key={run.id} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-ink">
                      {run.rootFolder === "" ? "Everything" : run.rootFolder}
                    </span>
                    <span className="text-muted">{run.status}</span>
                  </div>
                  <p className="text-muted">
                    {run.tracksAdded} added, {run.tracksUpdated} updated, {run.filesSkipped}{" "}
                    skipped
                    {run.filesFailed > 0 && `, ${run.filesFailed} failed`}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

function ScanProgress({ status }: { status: ScanStatusView }) {
  const isRunning = status.status === "running" && !status.isStale;

  return (
    <div className="mt-2 rounded-xl border border-line p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          {status.rootFolder === "" ? "Everything" : status.rootFolder}
        </p>
        {/* The percentage. Undefined while phase one counts, so the bar is
            indeterminate rather than showing a misleading 0%. */}
        <p className="font-mono text-xs text-muted">
          {status.percent === undefined ? (isRunning ? "counting..." : "-") : `${status.percent}%`}
        </p>
      </div>

      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line">
        {status.percent === undefined ? (
          <div className={`h-full w-1/3 bg-brass ${isRunning ? "animate-pulse" : ""}`} />
        ) : (
          <div
            className="h-full bg-brass transition-[width] duration-300"
            style={{ width: `${status.percent}%` }}
          />
        )}
      </div>

      <p className="mt-2 font-mono text-xs text-ink">
        {status.filesSeen.toLocaleString()}
        {status.filesTotal > 0 && ` / ${status.filesTotal.toLocaleString()}`} files
      </p>

      {/* The filename being read right now -- the other half of what was asked for. */}
      {status.currentPath !== "" && (
        <p className="mt-1 truncate font-mono text-xs text-muted" title={status.currentPath}>
          {status.currentPath}
        </p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <Stat label="Added" value={status.tracksAdded} />
        <Stat label="Updated" value={status.tracksUpdated} />
        <Stat label="Skipped" value={status.filesSkipped} />
        <Stat label="Failed" value={status.filesFailed} />
      </dl>

      {status.isStale && status.status === "running" && (
        <p className="mt-3 text-xs text-muted">
          This scan stopped reporting - the server probably restarted. Starting another is safe:
          unchanged files are skipped.
        </p>
      )}

      {status.lastError !== "" && (
        <p className="mt-3 break-words rounded border border-line bg-paper p-2 text-xs text-muted">
          {status.lastError}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-mono text-ink">{value.toLocaleString()}</dd>
    </>
  );
}
