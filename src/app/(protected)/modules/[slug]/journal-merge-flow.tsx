"use client";

// The two dialogs of a merge, shared by the Review Data screen and the Entries
// grid's Merge bulk action:
//
//   1. the draft — the ordinary entry form, seeded with the merged draft, and
//      nothing is written until the reader saves it;
//   2. the "delete the originals?" offer, shown once the merged entry is saved.
//
// The dialogs, and `useJournalMerge`, the flow's state and handlers, for the
// Entries grid tabs, the Search tab and the Log tab. The reads and writes are
// the server actions in journal-bulk-actions.ts; each screen supplies how it
// redraws its own rows. The Review Data screen keeps its own flow, because its
// cleanup binds through the same-date action rather than the grid's delete.
// Keeping the dialogs in one place means a change to how a merged entry is
// written lands on every grid at once.

import { useState } from "react";
import { Button } from "@/components/button";
import { Modal } from "@/components/modal";
import type { DashboardTextureItem } from "@/lib/dashboard-texture";
import type {
  JournalEntry,
  JournalPreferences,
  JournalPrefillTemplate,
  MergedEntryDraft,
} from "@/lib/journal";
import {
  buildJournalMergeDraftAction,
  deleteJournalEntriesAction,
  refreshJournalEntriesAction,
  type BulkRefreshScope,
} from "./journal-bulk-actions";
import { JournalEntryForm } from "./journal-entry-form";

/** An open merge dialog: the draft being edited, and how it got there. */
export interface PendingMerge {
  draft: MergedEntryDraft;
  /**
   * The entries the draft was built from — the ids the action actually read,
   * not everything the reader ticked. The post-save offer deletes exactly these.
   */
  sourceIds: number[];
  sourceCount: number;
  /** Locked entries the action left out. Shown in the dialog, never merged. */
  skippedLockedCount: number;
  clearSelection: () => void;
}

/** The "delete the originals?" offer, shown once a merged entry is saved. */
export interface PendingMergeCleanup {
  sourceIds: number[];
}

/** What the entry form needs, supplied by the screen that opens the merge. */
export interface MergeFormOptions {
  categoryOptions: string[];
  tagOptions: string[];
  preferences: JournalPreferences;
  contentTextures?: DashboardTextureItem[];
  prefillTemplates: JournalPrefillTemplate[];
  locationCategoryOptions: string[];
  locationTagOptions: string[];
}

export interface JournalMergeDialogsProps {
  merge?: PendingMerge;
  cleanup?: PendingMergeCleanup;
  formOptions: MergeFormOptions;
  /** Disables the cleanup buttons while the originals are being binned. */
  isBusy: boolean;
  onMergeClose: () => void;
  onSavingChange: (saving: boolean) => void;
  /** The merged entry is written. The screen clears the selection and opens the offer. */
  onMergeSaved: (merge: PendingMerge) => void;
  onCleanupKeep: () => void;
  onCleanupDelete: (sourceIds: number[]) => void;
}

function plural(count: number): string {
  return count === 1 ? "entry" : "entries";
}

export interface UseJournalMergeOptions {
  /** The grid's current scope, so the re-read and the delete use the same rows. */
  scope: () => BulkRefreshScope;
  /** Swaps in the server's rows and says what happened. Each grid's own. */
  applyRows: (entries: JournalEntry[], message: string) => void;
  setError: (message: string | undefined) => void;
  setNotice: (message: string) => void;
  setBusy: (busy: boolean) => void;
}

/**
 * The Merge flow's state and handlers, shared by every grid that offers Merge
 * (the Entries tabs, the Search tab and the Log tab).
 *
 * Each screen supplies how it re-reads and redraws its own rows, so this holds
 * the flow, not the list. Nothing is written until the reader saves the draft,
 * and the originals are only binned after that.
 */
export function useJournalMerge({
  scope,
  applyRows,
  setError,
  setNotice,
  setBusy,
}: UseJournalMergeOptions) {
  const [merge, setMerge] = useState<PendingMerge | undefined>(undefined);
  const [cleanup, setCleanup] = useState<PendingMergeCleanup | undefined>(undefined);

  /** Builds the draft and opens it. Nothing is written by this. */
  async function start(rows: JournalEntry[], clearSelection: () => void) {
    setBusy(true);
    setError(undefined);
    try {
      const result = await buildJournalMergeDraftAction(rows.map((row) => row.id));
      if (!result.ok || !result.draft) {
        setError(result.error ?? "Failed to build the merged entry.");
        return;
      }
      // `mergedIds` is what the action actually read, never the raw selection.
      const sourceIds = result.mergedIds ?? rows.map((row) => row.id);
      setMerge({
        draft: result.draft,
        sourceIds,
        sourceCount: result.mergedCount ?? sourceIds.length,
        skippedLockedCount: result.skippedLockedCount ?? 0,
        clearSelection,
      });
    } finally {
      setBusy(false);
    }
  }

  /** Re-reads the grid for its current scope. Nothing is written by this. */
  async function reload(message: string) {
    setBusy(true);
    try {
      const result = await refreshJournalEntriesAction(scope());
      if (!result.ok || !result.entries) {
        setError(result.error ?? "Failed to re-read the entries.");
        return;
      }
      applyRows(result.entries, message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * The merged entry is written. Clear the ticks, show the new entry in the grid,
   * then offer to bin the originals. They stay in place until the reader chooses.
   */
  async function handleSaved(saved: PendingMerge) {
    saved.clearSelection();
    setMerge(undefined);
    setCleanup({ sourceIds: saved.sourceIds });
    await reload("Merged entry saved. Choose whether to delete the originals.");
  }

  /** Bins the originals, through the same delete the grid's Delete uses. */
  async function runCleanup(sourceIds: number[]) {
    setBusy(true);
    try {
      const result = await deleteJournalEntriesAction(sourceIds, scope());
      setCleanup(undefined);
      if (!result.ok || !result.entries) {
        // The merge itself succeeded — say so, or the reader thinks the new entry is lost too.
        setError(
          `${result.error ?? "That didn't work."} The merged entry was saved — only ` +
            "removing the originals failed. Tick them and use Delete to finish.",
        );
        return;
      }
      const count = result.movedCount ?? 0;
      applyRows(
        result.entries,
        `Merged entry saved, and moved ${count} original ${plural(count)} to the recycle bin — ` +
          "restore them from Data Management → CSV Import → Correct if you need them back.",
      );
    } finally {
      setBusy(false);
    }
  }

  /** Declining the offer is normal: the merged entry is saved and the originals stay. */
  function keep() {
    setCleanup(undefined);
    setNotice("Merged entry saved. The originals are still here.");
  }

  function close() {
    setMerge(undefined);
  }

  return { merge, cleanup, start, close, handleSaved, runCleanup, keep };
}

export function JournalMergeDialogs({
  merge,
  cleanup,
  formOptions,
  isBusy,
  onMergeClose,
  onSavingChange,
  onMergeSaved,
  onCleanupKeep,
  onCleanupDelete,
}: JournalMergeDialogsProps) {
  return (
    <>
      {merge && (
        <Modal
          title={`Merge ${merge.sourceCount} ${plural(merge.sourceCount)}`}
          description={
            "This is a draft — nothing has been saved and none of the original entries have " +
            "been touched. Edit it as you like, then save it to create one new entry. You'll " +
            "be asked afterwards whether to delete the originals." +
            (merge.skippedLockedCount > 0
              ? ` ${merge.skippedLockedCount} locked ${plural(merge.skippedLockedCount)} ` +
                `you ticked ${merge.skippedLockedCount === 1 ? "was" : "were"} left out, ` +
                "because locked entries can't be merged."
              : "")
          }
          size="lg"
          onClose={onMergeClose}
        >
          {/* The same form the New Journal Entry section uses, seeded with the
              draft. Reused rather than rebuilt so the merged entry gets the
              location picker, the weather fetch, the handwriting sheet and the
              fullscreen editor for free. */}
          <JournalEntryForm
            categoryOptions={formOptions.categoryOptions}
            tagOptions={formOptions.tagOptions}
            preferences={formOptions.preferences}
            contentTextures={formOptions.contentTextures ?? []}
            prefillTemplates={formOptions.prefillTemplates}
            locationCategoryOptions={formOptions.locationCategoryOptions}
            locationTagOptions={formOptions.locationTagOptions}
            initialValues={merge.draft}
            saveLabel="Save merged entry"
            onSavingChange={onSavingChange}
            onSaved={() => onMergeSaved(merge)}
          />
        </Modal>
      )}

      {cleanup && (
        <Modal
          title="Merged entry created successfully"
          description={
            `Would you like to delete the original ${cleanup.sourceIds.length} ` +
            `${plural(cleanup.sourceIds.length)} the merge was built from? They move ` +
            "to the recycle bin, so this can be undone."
          }
          // Declining is a normal outcome, not a dismissal to recover from: the
          // merged entry is saved and the originals stay.
          onClose={onCleanupKeep}
          isBusy={isBusy}
          footer={
            <>
              <Button variant="secondary" disabled={isBusy} onClick={onCleanupKeep}>
                Keep them
              </Button>
              <Button
                variant="danger"
                disabled={isBusy}
                onClick={() => onCleanupDelete(cleanup.sourceIds)}
              >
                {isBusy ? "Working…" : `Delete ${cleanup.sourceIds.length}`}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink">
            The merged entry has been saved. Deleting the originals moves{" "}
            {cleanup.sourceIds.length} {plural(cleanup.sourceIds.length)} to the
            recycle bin.
          </p>
        </Modal>
      )}
    </>
  );
}
