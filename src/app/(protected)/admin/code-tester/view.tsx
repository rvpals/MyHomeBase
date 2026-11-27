"use client";

// Client presentation for Administration -> Code Tester.
//
// ONE CARD PER EXPERIMENT. Each is a self-contained component below, calling its own
// server action into `src/lib/code-test/`. Adding an experiment is a new card component
// and one line in `CodeTesterView` -- no registry, no framework.

import { useState } from "react";
import { BusyOverlay } from "@/components/busy-overlay";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { Modal } from "@/components/modal";
// Types only: the values behind `@/lib/code-test` include Node-only probes.
import type {
  DependencyCheckResult,
  DependencyCheckSummary,
  DependencyReport,
  DependencyStatus,
} from "@/lib/code-test";
import { PAGE_CONTAINER } from "../../page-container";
import {
  listCodeTestFoldersAction,
  runDependencyCheckAction,
  runServerResizeSuiteAction,
} from "./actions";

/** Matches the other admin screens' fields. */
const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function CodeTesterView({ dependencies }: { dependencies: DependencyCheckSummary[] }) {
  return (
    <div className={PAGE_CONTAINER}>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Code Tester</h1>
      <p className="mt-2 text-sm text-muted">
        Experiments run against this server, to answer &ldquo;would this be worth
        building?&rdquo; with real numbers. Nothing here changes any data.
      </p>

      <div className="mt-6 space-y-6">
        <ServerResizeCard />
        <DependencyTestCard dependencies={dependencies} />
        {/* Next experiment: its own card component, added here. */}
      </div>
    </div>
  );
}

/** The message of whatever an action threw, e.g. "Administrators only." */
function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Experiment 1: how long a server-side resize takes, and how many bytes it saves.
 *
 * Pick a folder by date -> folder (the archive's own date-based browsing). The server
 * scans it, picks three photos (EXIF preview, no preview, largest), runs the test on each,
 * and the combined report opens in a dialog.
 */
function ServerResizeCard() {
  const [date, setDate] = useState("");
  const [folders, setFolders] = useState<{ name: string; relativePath: string; photoCount: number }[]>();
  const [folderPath, setFolderPath] = useState("");
  const [busy, setBusy] = useState<"folders" | "test" | undefined>();
  const [error, setError] = useState<string>();
  const [report, setReport] = useState<string>();
  const [isCopied, setIsCopied] = useState(false);

  async function findFolders() {
    setBusy("folders");
    setError(undefined);
    setFolders(undefined);
    setFolderPath("");
    try {
      const result = await listCodeTestFoldersAction(date);
      if (!result.ok) {
        setError(result.error ?? "Couldn't look up folders.");
        return;
      }
      setFolders(result.folders ?? []);
    } catch (thrown) {
      setError(messageOf(thrown, "Couldn't look up folders."));
    } finally {
      setBusy(undefined);
    }
  }

  async function runTest() {
    setBusy("test");
    setError(undefined);
    try {
      const result = await runServerResizeSuiteAction(folderPath);
      if (!result.ok || result.report === undefined) {
        setError(result.error ?? "The test didn't run.");
        return;
      }
      setIsCopied(false);
      setReport(result.report);
    } catch (thrown) {
      setError(messageOf(thrown, "The test didn't run."));
    } finally {
      setBusy(undefined);
    }
  }

  async function copyReport() {
    if (report === undefined) return;
    try {
      await navigator.clipboard.writeText(report);
      setIsCopied(true);
    } catch {
      // A denied clipboard is not worth a dialog: the report is on screen and selectable.
      setIsCopied(false);
    }
  }

  return (
    <>
      <CollapsibleCard title="Test Image Serve Resize Load" defaultOpen>
        <p className="text-sm text-muted">
          Scans a whole folder of the archive cheaply (a stat and the first 128KB per photo,
          never the whole file), then runs four experiments on photos chosen from it: the
          size distribution, resizes to 160/1024/2048px, the strip&rsquo;s embedded-preview
          path against the whole-file fallback, and resize throughput at 1&ndash;4 at once.
          The archive is only read, never written.
        </p>

        {/* Stacked on a phone, one row on a desktop. */}
        <div className="mt-4 grid grid-cols-[12rem_minmax(0,1fr)] items-end gap-3 max-lg:grid-cols-1">
          {/* A div, not a label: it holds the button too, and a label may name one control. */}
          <div className="block text-sm">
            <span className="mb-1 block text-muted">1. Date</span>
            <div className="flex gap-2">
              <input
                type="date"
                aria-label="Date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className={INPUT_CLASS}
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void findFolders()}
                disabled={date === "" || busy !== undefined}
              >
                {busy === "folders" ? "Finding…" : "Find"}
              </Button>
            </div>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-muted">2. Folder</span>
            <select
              value={folderPath}
              onChange={(event) => setFolderPath(event.target.value)}
              disabled={folders === undefined || folders.length === 0 || busy !== undefined}
              className={INPUT_CLASS}
            >
              <option value="">
                {folders === undefined
                  ? "Find a date's folders first"
                  : folders.length === 0
                    ? "No folders for that date"
                    : "Choose a folder…"}
              </option>
              {folders?.map((folder) => (
                <option key={folder.relativePath} value={folder.relativePath}>
                  {folder.name} ({folder.photoCount})
                </option>
              ))}
            </select>
          </label>
        </div>

        {error !== undefined && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="mt-4 max-lg:[&>*]:w-full">
          <Button onClick={() => void runTest()} disabled={folderPath === "" || busy !== undefined}>
            {busy === "test" ? "Running…" : "Run the suite"}
          </Button>
        </div>
      </CollapsibleCard>

      <BusyOverlay
        isBusy={busy === "test"}
        message="Scanning the folder and running the suite…"
        detail="Scanning every photo in the folder, then resizing a few of them many times over. Expect 30 to 60 seconds."
        progress="indeterminate"
      />

      {report !== undefined && (
        <Modal
          title="Server resize tests"
          size="lg"
          onClose={() => setReport(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => void copyReport()}>
                {isCopied ? "Copied" : "Copy"}
              </Button>
              <Button onClick={() => setReport(undefined)}>Close</Button>
            </>
          }
        >
          <pre className="max-h-[60vh] overflow-auto rounded-md border border-line bg-paper p-3 font-mono text-xs leading-5 whitespace-pre text-ink max-lg:text-[11px]">
            {report}
          </pre>
        </Modal>
      )}
    </>
  );
}

/** Semantic colours stay literal, per design.md's red/green exception. */
const STATUS_TEXT: Record<DependencyStatus | "idle" | "running", { label: string; className: string }> = {
  idle: { label: "Not run", className: "text-muted" },
  running: { label: "Running…", className: "text-brass" },
  pass: { label: "Pass", className: "text-emerald-400" },
  warn: { label: "Warning", className: "text-amber-400" },
  fail: { label: "Fail", className: "text-red-400" },
};

const STEP_MARK: Record<DependencyStatus, string> = { pass: "✓", warn: "!", fail: "✗" };

/** `12.3 ms` / `845 ms` / `3.72 s`. Display only; the lib formats the copied report itself. */
function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(1)} ms`;
}

/**
 * Experiment 2: do the fragile native/WASM dependencies still load and work here?
 *
 * One row per dependency with its own Test button, plus Test all. Each result shows
 * the steps it ran (timed) and the facts that explain a break -- the platform build
 * installed, the ABI, where the OCR model is read from. A failed or warning row opens
 * its details by itself. The same use-case is `npm run cli -- check-dependencies`.
 */
function DependencyTestCard({ dependencies }: { dependencies: DependencyCheckSummary[] }) {
  const [results, setResults] = useState<Record<string, DependencyCheckResult>>({});
  const [running, setRunning] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [lastRun, setLastRun] = useState<{ report: DependencyReport; text: string }>();
  const [isCopied, setIsCopied] = useState(false);

  const isBusy = running.length > 0;

  async function run(ids: string[]) {
    setRunning(ids.length === 0 ? dependencies.map((dependency) => dependency.id) : ids);
    setError(undefined);
    try {
      const result = await runDependencyCheckAction(ids);
      if (!result.ok || result.report === undefined || result.text === undefined) {
        setError(result.error ?? "The checks didn't run.");
        return;
      }
      const report = result.report;
      setResults((previous) => {
        const next = { ...previous };
        for (const item of report.results) next[item.id] = item;
        return next;
      });
      setLastRun({ report, text: result.text });
      setIsCopied(false);
    } catch (thrown) {
      setError(messageOf(thrown, "The checks didn't run."));
    } finally {
      setRunning([]);
    }
  }

  async function copyReport() {
    if (lastRun === undefined) return;
    try {
      await navigator.clipboard.writeText(lastRun.text);
      setIsCopied(true);
    } catch {
      setIsCopied(false);
    }
  }

  const runtime = lastRun?.report.runtime;

  return (
    <>
      <CollapsibleCard title="Dependency test" defaultOpen>
        <p className="text-sm text-muted">
          Loads each fragile dependency the way the app does and gives it a small real job:
          a database round-trip, OCR of a built-in sample, an image resize, a canvas draw.
          It catches a binding built for the wrong Node, a build for the wrong platform, or
          a missing OCR model before a feature trips over it. Touches no app data.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3 max-lg:[&>button]:flex-1">
          <Button onClick={() => void run([])} disabled={isBusy}>
            {isBusy && running.length > 1 ? "Testing all…" : "Test all"}
          </Button>
          <Button variant="secondary" onClick={() => void copyReport()} disabled={lastRun === undefined}>
            {isCopied ? "Copied" : "Copy report"}
          </Button>
        </div>

        {runtime !== undefined && (
          <p className="mt-3 font-mono text-xs break-words text-muted">
            Node {runtime.node} (ABI {runtime.abi}) · {runtime.platform}/{runtime.arch} · {runtime.hostname} ·
            RSS {runtime.rssMb} MB · last run {new Date(lastRun!.report.ranAt).toLocaleTimeString()}
          </p>
        )}

        {error !== undefined && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        )}

        <ul className="mt-4 divide-y divide-line rounded-md border border-line">
          {dependencies.map((dependency) => (
            <DependencyRow
              key={dependency.id}
              dependency={dependency}
              result={results[dependency.id]}
              isRunning={running.includes(dependency.id)}
              isDisabled={isBusy}
              onTest={() => void run([dependency.id])}
            />
          ))}
        </ul>
      </CollapsibleCard>

      <BusyOverlay
        isBusy={isBusy}
        message={running.length > 1 ? "Testing every dependency…" : "Testing the dependency…"}
        detail="OCR loads its engine and model and reads a sample; expect a few seconds here, longer on the NAS."
        progress="indeterminate"
      />
    </>
  );
}

function DependencyRow({
  dependency,
  result,
  isRunning,
  isDisabled,
  onTest,
}: {
  dependency: DependencyCheckSummary;
  result: DependencyCheckResult | undefined;
  isRunning: boolean;
  isDisabled: boolean;
  onTest: () => void;
}) {
  const status = STATUS_TEXT[isRunning ? "running" : (result?.status ?? "idle")];

  return (
    <li className="p-3">
      {/* Name and summary beside the button on a desktop; stacked, button full-width, on a phone. */}
      <div className="flex items-start gap-3 max-lg:flex-col">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-medium text-ink">{dependency.label}</span>
            {result !== undefined && (
              <span className="font-mono text-xs text-muted">
                {result.version} · {formatDuration(result.totalMs)}
              </span>
            )}
            <span className={`text-sm font-semibold ${status.className}`}>{status.label}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted">{dependency.purpose}</p>
          {result !== undefined && !isRunning && (
            <p className={`mt-1 text-sm break-words ${result.status === "pass" ? "text-ink" : status.className}`}>
              {result.summary}
            </p>
          )}
        </div>
        <div className="shrink-0 max-lg:w-full max-lg:[&>*]:w-full">
          <Button size="sm" variant="secondary" onClick={onTest} disabled={isDisabled}>
            {isRunning ? "Testing…" : "Test"}
          </Button>
        </div>
      </div>

      {result !== undefined && !isRunning && (
        // Keyed on the run, so a new result re-applies "open when it needs looking at".
        <details key={`${result.status}-${result.totalMs}`} open={result.status !== "pass"} className="mt-2">
          <summary className="cursor-pointer text-xs text-muted select-none hover:text-ink">
            Details: {result.steps.length} steps, {result.facts.length} facts
          </summary>

          <div className="mt-2 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
            <section>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Steps</h3>
              <ol className="space-y-1">
                {result.steps.map((step, index) => (
                  <li key={index} className="grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-x-2 text-xs">
                    <span aria-hidden className={STATUS_TEXT[step.status].className}>
                      {STEP_MARK[step.status]}
                    </span>
                    <span className="min-w-0">
                      <span className="text-ink">{step.name}</span>
                      <span className="sr-only"> ({STATUS_TEXT[step.status].label})</span>
                      <span className={`block break-words ${step.status === "pass" ? "text-muted" : STATUS_TEXT[step.status].className}`}>
                        {step.detail}
                      </span>
                    </span>
                    <span className="font-mono text-muted">{step.ms === undefined ? "" : formatDuration(step.ms)}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section>
              <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Facts</h3>
              <dl className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                {result.facts.map((fact, index) => (
                  <div key={index} className="contents">
                    <dt className="text-muted">{fact.label}</dt>
                    <dd className="font-mono break-all text-ink">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </details>
      )}
    </li>
  );
}
