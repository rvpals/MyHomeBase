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
import {
  listCodeTestFoldersAction,
  listCodeTestPhotosAction,
  runServerResizeTestAction,
} from "./actions";

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
 * Pick a photo by date -> folder -> photo (the archive's own date-based browsing), run
 * the test, read the report in a dialog.
 */
function ServerResizeCard() {
  const [date, setDate] = useState("");
  const [folders, setFolders] = useState<{ name: string; relativePath: string; photoCount: number }[]>();
  const [folderPath, setFolderPath] = useState("");
  const [photos, setPhotos] = useState<{ name: string; relativePath: string }[]>();
  const [photoPath, setPhotoPath] = useState("");
  const [busy, setBusy] = useState<"folders" | "photos" | "test" | undefined>();
  const [error, setError] = useState<string>();
  const [report, setReport] = useState<string>();
  const [isCopied, setIsCopied] = useState(false);

  async function findFolders() {
    setBusy("folders");
    setError(undefined);
    setFolders(undefined);
    setFolderPath("");
    setPhotos(undefined);
    setPhotoPath("");
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

  async function chooseFolder(relativePath: string) {
    setFolderPath(relativePath);
    setPhotos(undefined);
    setPhotoPath("");
    if (relativePath === "") return;
    setBusy("photos");
    setError(undefined);
    try {
      const result = await listCodeTestPhotosAction(relativePath);
      if (!result.ok) {
        setError(result.error ?? "Couldn't list that folder.");
        return;
      }
      setPhotos(result.photos ?? []);
    } catch (thrown) {
      setError(messageOf(thrown, "Couldn't list that folder."));
    } finally {
      setBusy(undefined);
    }
  }

  async function runTest() {
    setBusy("test");
    setError(undefined);
    try {
      const result = await runServerResizeTestAction(photoPath);
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
          Reads one photo from the archive and resizes it on the server to 160, 1024 and
          2048px, timing each step and comparing the bytes with the original. The archive is
          only read, never written.
        </p>

        {/* Stacked on a phone, one row on a desktop. */}
        <div className="mt-4 grid grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-3 max-lg:grid-cols-1">
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
              onChange={(event) => void chooseFolder(event.target.value)}
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

          <label className="block text-sm">
            <span className="mb-1 block text-muted">3. Photo</span>
            <select
              value={photoPath}
              onChange={(event) => setPhotoPath(event.target.value)}
              disabled={photos === undefined || photos.length === 0 || busy !== undefined}
              className={INPUT_CLASS}
            >
              <option value="">
                {busy === "photos"
                  ? "Reading the folder…"
                  : photos === undefined
                    ? "Choose a folder first"
                    : photos.length === 0
                      ? "No photos in that folder"
                      : "Choose a photo…"}
              </option>
              {photos?.map((photo) => (
                <option key={photo.relativePath} value={photo.relativePath}>
                  {photo.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {photoPath !== "" && (
          <p className="mt-3 break-all font-mono text-xs text-muted">{photoPath}</p>
        )}

        {error !== undefined && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="mt-4 max-lg:[&>*]:w-full">
          <Button onClick={() => void runTest()} disabled={photoPath === "" || busy !== undefined}>
            {busy === "test" ? "Running…" : "Run test"}
          </Button>
        </div>
      </CollapsibleCard>

      <BusyOverlay
        isBusy={busy === "test"}
        message="Running the resize test…"
        detail="Reading the photo from the NAS and resizing it three times. This can take a few seconds."
        progress="indeterminate"
      />

      {report !== undefined && (
        <Modal
          title="Server resize test"
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
