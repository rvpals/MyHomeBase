"use client";

// The Meta Data section's backup controls.
//
// Two halves that deliberately live in different places on the screen:
//
//   `JournalMetadataBackupButton` — the "Back up all meta data" button that sits
//   in the section's title bar, beside the heading. A download needs no input, so
//   it belongs up there with the other whole-screen actions rather than inside a
//   card the reader has to scroll to.
//
//   `JournalMetadataRestoreCard` — the restore half, which needs a dropzone and a
//   confirmation dialog and so cannot live in a title bar. Rendered in the section
//   body under Categories & Tags.
//
// Route-local rather than registered: nothing outside My Journal renders these.

import { useCallback, useState } from "react";
import { Button } from "@/components/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { FileDropzone } from "@/components/file-dropzone";
import { Modal } from "@/components/modal";
import type { JournalMetadataPlan, JournalMetadataRestoreSummary } from "@/lib/journal";
import {
  planJournalMetadataImportAction,
  runJournalMetadataImportAction,
} from "./journal-metadata-transfer-actions";

const EXPORT_URL = "/api/journal/metadata/export";

/** Saves a fetched response as a file, reading the name off Content-Disposition. */
async function saveResponseAsFile(response: Response, fallbackName: string): Promise<void> {
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;

  // The same blob-and-anchor dance DataGrid's Export CSV and the favourite-photos
  // download use. Repeated a fourth time here rather than extracted, because the
  // extraction is worth doing once across all four call sites and not as a
  // side-effect of this feature.
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Downloads every category, tag, icon, template, filter and preference as one
 * JSON file.
 *
 * Fetched rather than linked: `Button` renders a `next/link` when given an
 * `href`, which would client-navigate to the API route instead of downloading it,
 * and widening the shared component with a `download` prop for one caller isn't
 * worth it. Every other download in the app is a click handler too.
 */
export function JournalMetadataBackupButton() {
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string>();

  const handleBackup = useCallback(async () => {
    setIsBusy(true);
    setError(undefined);
    try {
      const response = await fetch(EXPORT_URL);
      if (!response.ok) {
        setError("Couldn't build that backup.");
        return;
      }
      await saveResponseAsFile(response, "journal-metadata.json");
    } catch {
      setError("Couldn't build that backup.");
    } finally {
      setIsBusy(false);
    }
  }, []);

  return (
    // The error sits under the button rather than in a toast: it's the only place
    // on the screen that could have produced it, and a title-bar action with no
    // feedback reads as a dead button.
    <div className="flex flex-col items-end gap-1 max-lg:w-full max-lg:items-stretch">
      <Button
        variant="secondary"
        onClick={handleBackup}
        disabled={isBusy}
        className="max-lg:w-full"
        title="Download every category, tag, icon, template, filter and preference as one file"
      >
        {isBusy ? "Backing up…" : "Back up all meta data"}
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

type JournalMetadataPlanRowKind = JournalMetadataPlan["rows"][number]["kind"];

const KIND_LABELS: Record<JournalMetadataPlanRowKind, string> = {
  category: "Categories",
  tag: "Tags",
  template: "Templates",
  filter: "Saved filters",
};

/** One line of the plan, e.g. "12 new, 40 updated". */
function planSummaryLine(plan: JournalMetadataPlan): string {
  const parts: string[] = [];
  if (plan.createCount > 0) parts.push(`${plan.createCount} new`);
  if (plan.updateCount > 0) parts.push(`${plan.updateCount} updated`);
  if (parts.length === 0) return "This backup holds no categories, tags, templates or filters.";
  return parts.join(", ");
}

/** Per-kind create/update tallies, so the dialog says what's changing where. */
function tallyByKind(plan: JournalMetadataPlan) {
  const kinds: JournalMetadataPlanRowKind[] = ["category", "tag", "template", "filter"];
  return kinds
    .map((kind) => {
      const rows = plan.rows.filter((row) => row.kind === kind);
      return {
        kind,
        created: rows.filter((row) => row.action === "create").length,
        updated: rows.filter((row) => row.action === "update").length,
      };
    })
    .filter((entry) => entry.created + entry.updated > 0);
}

/**
 * Restores a backup file over the top of what's stored: file wins, nothing
 * deleted.
 *
 * Two steps on purpose. Dropping the file only *plans* — the dialog then says how
 * many names are new, how many will be overwritten, and how many icons will be
 * replaced, before anything is written. Same shape as the CSV import's overwrite
 * confirmation, for the same reason: overwriting forty hand-chosen icons is not
 * something a single click should be able to do silently.
 */
export function JournalMetadataRestoreCard() {
  const [file, setFile] = useState<File>();
  const [plan, setPlan] = useState<JournalMetadataPlan>();
  const [summary, setSummary] = useState<JournalMetadataRestoreSummary>();
  const [error, setError] = useState<string>();
  const [isBusy, setIsBusy] = useState(false);

  const handleFile = useCallback(async (chosen: File) => {
    setIsBusy(true);
    setError(undefined);
    setSummary(undefined);
    setPlan(undefined);

    // Posted as FormData rather than read to a string here: the file carries every
    // icon as base64 and a server-action string argument would inflate it another
    // ~33% against the body limit.
    const formData = new FormData();
    formData.append("bundle", chosen);

    const result = await planJournalMetadataImportAction(formData);
    setIsBusy(false);

    if (!result.ok || !result.plan) {
      setError(result.error ?? "That file couldn't be read.");
      return;
    }
    setFile(chosen);
    setPlan(result.plan);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!file) return;
    setIsBusy(true);
    setError(undefined);

    const formData = new FormData();
    formData.append("bundle", file);

    const result = await runJournalMetadataImportAction(formData);
    setIsBusy(false);
    setPlan(undefined);

    if (!result.ok || !result.summary) {
      setError(result.error ?? "That backup couldn't be restored.");
      return;
    }
    setSummary(result.summary);
    setFile(undefined);
  }, [file]);

  const handleCancel = useCallback(() => {
    setPlan(undefined);
    setFile(undefined);
  }, []);

  const tallies = plan ? tallyByKind(plan) : [];

  return (
    // The Modal is a sibling of the card, not a child of its body.
    // `CollapsibleCard` unmounts its children when collapsed, so a dialog
    // rendered inside it would disappear — along with the pending file and the
    // plan — the moment the reader clicked the card's own header mid-confirm.
    <>
      <CollapsibleCard title="Restore meta data from a backup">
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Drop a backup file here to put its categories, tags, icons, templates, filters and
            preferences back. Anything already here with the same name takes the file&apos;s
            description and icon; nothing is deleted, and your journal entries aren&apos;t
            touched.
          </p>

          <FileDropzone
            onFile={handleFile}
            accept=".json,application/json"
            label="Drag a metadata backup (.json) here, or click to browse"
            disabled={isBusy}
          />

          {error && <p className="text-sm text-red-400">{error}</p>}

          {summary && (
            <div className="rounded-lg border border-line bg-paper p-3 text-sm text-ink">
              <p className="font-medium">Restored.</p>
              <ul className="mt-1 space-y-0.5 text-muted">
                <li>
                  {summary.categoryCount} categories, {summary.tagCount} tags
                  {summary.iconCount > 0 ? ` (${summary.iconCount} icons)` : ""}
                </li>
                <li>
                  {summary.templateCount} templates, {summary.filterCount} saved filters
                </li>
                {summary.preferenceEntries.length > 0 && <li>Preferences applied.</li>}
              </ul>
            </div>
          )}
        </div>
      </CollapsibleCard>

      {plan && (
        <Modal
          title="Restore this backup?"
          description={planSummaryLine(plan)}
          onClose={handleCancel}
          footer={
            <>
              <Button variant="secondary" onClick={handleCancel} disabled={isBusy}>
                Cancel
              </Button>
              <Button onClick={handleConfirm} disabled={isBusy}>
                {isBusy ? "Restoring…" : "Restore"}
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm text-ink">
            {tallies.length > 0 && (
              <ul className="space-y-1">
                {tallies.map((entry) => (
                  <li key={entry.kind} className="flex justify-between gap-4">
                    <span className="text-muted">{KIND_LABELS[entry.kind]}</span>
                    <span>
                      {entry.created > 0 && `${entry.created} new`}
                      {entry.created > 0 && entry.updated > 0 && ", "}
                      {entry.updated > 0 && `${entry.updated} updated`}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {plan.iconReplaceCount > 0 && (
              <p className="rounded-lg border border-line bg-paper p-2 text-muted">
                {plan.iconReplaceCount} existing{" "}
                {plan.iconReplaceCount === 1 ? "icon" : "icons"} will be replaced by the
                file&apos;s.
              </p>
            )}

            {plan.appliesPreferences && (
              <p className="text-muted">
                Preferences will be applied.
                {plan.skipsPhotoRoot && (
                  <>
                    {" "}
                    The photo folder in the file is left out — it&apos;s a path specific to the
                    machine it was exported from.
                  </>
                )}
              </p>
            )}

            <p className="text-muted">Nothing will be deleted, and no journal entries change.</p>
          </div>
        </Modal>
      )}
    </>
  );
}
