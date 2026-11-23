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
import { PAGE_CONTAINER } from "../../page-container";
import { listCodeTestFoldersAction, runServerResizeSuiteAction } from "./actions";

/** Matches the other admin screens' fields. */
const INPUT_CLASS =
  "w-full rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

export function CodeTesterView() {
  return (
    <div className={PAGE_CONTAINER}>
      <h1 className="mt-2 font-display text-3xl font-semibold text-ink">Code Tester</h1>
      <p className="mt-2 text-sm text-muted">
        Experiments run against this server, to answer &ldquo;would this be worth
        building?&rdquo; with real numbers. Nothing here changes any data.
      </p>

      <div className="mt-6 space-y-6">
        <ServerResizeCard />
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
          Scans a folder of the archive, picks three photos (one with an EXIF preview, one
          without, and the largest file) and, for each, resizes it on the server to 160, 1024
          and 2048px, timing each step and comparing the bytes with the original. The archive
          is only read, never written.
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
            {busy === "test" ? "Running…" : "Run 3 tests"}
          </Button>
        </div>
      </CollapsibleCard>

      <BusyOverlay
        isBusy={busy === "test"}
        message="Scanning the folder and running 3 tests…"
        detail="Reading the folder's photos from the NAS, then resizing three of them three times each. This can take a minute."
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
