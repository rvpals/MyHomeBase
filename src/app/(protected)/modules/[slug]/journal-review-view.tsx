"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { BusyOverlay } from "@/components/busy-overlay";
import { CollapsibleCard } from "@/components/collapsible-card";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { JournalViewer } from "@/components/journal-viewer";
import { Modal } from "@/components/modal";
import { SlotIcon } from "@/components/slot-icon";
import { TreeIcon } from "@/components/tree-icons";
import { getIconSlot } from "@/lib/icons";
import { countSameDateEntries, toSameDateRows } from "@/lib/journal";
import type {
  JournalEntry,
  JournalPreferences,
  JournalPrefillTemplate,
  MergedEntryDraft,
  SameDateGroup,
  SameDateRow,
} from "@/lib/journal";
import { JournalEntryEditForm } from "./entries/[id]/entry-edit-form";
import { JournalEntryForm } from "./journal-entry-form";
import {
  buildJournalMergeDraftAction,
  getJournalSameDateEntryAction,
  loadJournalSameDateDataAction,
  lockJournalSameDateEntriesAction,
  recycleJournalSameDateEntriesAction,
} from "./journal-review-actions";
import { journalEntriesFilterHref } from "./journal-shared";

const SAME_DATE_SLOT = getIconSlot("journal_card_same_date_entries")!;

export interface JournalReviewViewProps {
  groups: SameDateGroup[];
  categoryIcons: Record<string, string>;
  tagIcons: Record<string, string>;
  /** Everything below is for the merge dialog's entry form. */
  categoryOptions: string[];
  tagOptions: string[];
  preferences: JournalPreferences;
  prefillTemplates: JournalPrefillTemplate[];
  locationCategoryOptions: string[];
  locationTagOptions: string[];
}

/**
 * The Review Data section: the dates carrying more than one journal entry, with
 * bulk Delete and bulk Merge.
 *
 * The list is a `DataGrid` — the registered result grid, which brings paging,
 * search, per-column filters, selection pruned to the filtered set, CSV export
 * and the below-1024px card layout, so this screen needs no narrow-specific code
 * of its own. The date groups are flattened to rows for it (`toSameDateRows`),
 * each row carrying its date and "n of m", so a day still reads as a day in a
 * flat sortable list.
 *
 * The groups are held in state and replaced wholesale by the delete action's
 * response rather than patched locally: removing one of a date's two entries
 * drops that entire date from the list, because one entry is no longer a group.
 * Guessing that client-side would leave a lone row on screen claiming to be
 * "1 of 2".
 */
export function JournalReviewView({
  groups: initialGroups,
  categoryIcons,
  tagIcons,
  categoryOptions,
  tagOptions,
  preferences,
  prefillTemplates,
  locationCategoryOptions,
  locationTagOptions,
}: JournalReviewViewProps) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);

  const [openEntry, setOpenEntry] = useState<JournalEntry | undefined>(undefined);
  // Whether the open entry's modal is showing the reader or the editor. Reset
  // every time a different entry is opened, so a modal never opens mid-edit.
  const [isEditing, setIsEditing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | undefined>(undefined);
  const [pendingLock, setPendingLock] = useState<PendingLock | undefined>(undefined);
  const [merge, setMerge] = useState<PendingMerge | undefined>(undefined);
  const [mergeCleanup, setMergeCleanup] = useState<PendingMergeCleanup | undefined>(undefined);
  /**
   * The "Review only Log entries" toggle — view state, not a stored preference:
   * it is a lens you put the card into for this sitting.
   *
   * Narrowing happens on the server (`findSameDateGroups`'s `logOnly`) rather
   * than by filtering `groups` here, because the toggle changes *which dates
   * qualify at all* — a date with one Log entry beside two written ones has no
   * pile of logs on it and must disappear, which a client-side row filter would
   * render as "1 of 1".
   */
  const [logOnly, setLogOnly] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);
  /**
   * Set only while the **list itself** is being re-read — the Log-only lens and
   * the reload after an edit. Separate from `isBusy` on purpose: that flag also
   * covers the delete/lock/merge confirms, which already say they are working
   * inside their own dialog, and dimming the whole screen for those would be a
   * second, louder answer to a question the dialog has already answered.
   *
   * This one has no dialog of its own. Re-scanning the journal for dates
   * carrying several entries reads every entry, which on a full journal takes
   * long enough that a checkbox flipping with nothing else happening reads as a
   * click that didn't land.
   */
  const [isScanning, setIsScanning] = useState(false);
  /**
   * What the overlay says — each path sets it before raising the flag.
   *
   * A pair rather than one string because the second line is the *consequence*
   * and genuinely differs: a re-scan is reading the whole journal, a delete is
   * writing to the bin. One generic line covering both would say nothing.
   */
  const [scanLabel, setScanLabel] = useState<{ message: string; detail: string }>({
    message: "Finding dates with several entries…",
    detail: "Reading every entry in the journal to group them by date.",
  });

  const rows = toSameDateRows(groups);
  const entryCount = countSameDateEntries(groups);

  /**
   * Opens one entry in the viewer.
   *
   * The rows carry a 100-word excerpt only, so the full entry is fetched on
   * click rather than every row shipping its whole content — see
   * getJournalSameDateEntryAction. Closing the modal is the "go back to the
   * list" the request asked for: the list is still mounted underneath with its
   * page, sort and ticks intact, which a route change would have thrown away.
   *
   * Always opens in read mode: `Edit` inside the modal is the way into the
   * editor, so clicking a row can never land the reader in a form they didn't
   * ask for.
   */
  async function openEntryById(entryId: number) {
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await getJournalSameDateEntryAction(entryId);
      if (!result.ok || !result.entry) {
        setError(result.error ?? "Failed to open that entry.");
        return;
      }
      setIsEditing(false);
      setOpenEntry(result.entry);
    } finally {
      setIsBusy(false);
    }
  }

  /**
   * Flips the Log-only lens and re-reads the list under it.
   *
   * The new value is applied optimistically so the switch responds at once, and
   * is passed explicitly to the action rather than read back from state — the
   * `useState` setter has not landed by the time this call is made.
   */
  async function toggleLogOnly(next: boolean) {
    setLogOnly(next);
    setIsBusy(true);
    setScanLabel({
      message: next
        ? "Finding dates with several Log entries…"
        : "Finding dates with several entries…",
      detail: "Reading every entry in the journal to group them by date.",
    });
    setIsScanning(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await loadJournalSameDateDataAction(next);
      if (!result.ok || !result.groups) {
        // Put the switch back: the list on screen is still the old lens's, and
        // leaving the two disagreeing is worse than not having flipped.
        setLogOnly(!next);
        setError(result.error ?? "Failed to re-read the list.");
        return;
      }
      setGroups(result.groups);
    } finally {
      setIsBusy(false);
      setIsScanning(false);
    }
  }

  /**
   * Bins the entries a just-saved merge was built from.
   *
   * Deliberately the same `recycleJournalSameDateEntriesAction` the Delete
   * button calls, so there is one delete path on this screen: the originals land
   * in the recycle bin and are restorable, rather than this being a second,
   * quieter kind of deletion that happens to be final.
   *
   * The merged entry is already written when this runs, so the worst case is the
   * one this screen started from — the merge exists and the originals are still
   * there — which the Delete button can finish by hand.
   */
  async function runMergeCleanup(sourceIds: number[]) {
    setIsBusy(true);
    setScanLabel({
      message: `Moving ${sourceIds.length} original ${plural(sourceIds.length)} to the recycle bin…`,
      detail: "The merged entry is already saved — this is only the clean-up.",
    });
    setIsScanning(true);
    setError(undefined);
    try {
      const result = await recycleJournalSameDateEntriesAction(sourceIds, logOnly);
      if (!result.ok) {
        // The merge itself succeeded, so this is not a failed merge — say so,
        // or the reader is left thinking they have lost the new entry too.
        setError(
          `${result.error ?? "That didn't work."} The merged entry was saved — only ` +
            "removing the originals failed. Tick them and use Delete to finish.",
        );
        setMergeCleanup(undefined);
        return;
      }
      if (result.groups) setGroups(result.groups);
      setMergeCleanup(undefined);
      setNotice(
        `Merged entry saved, and moved ${result.movedCount} original ` +
          `${plural(result.movedCount ?? 0)} to the recycle bin — restore them from ` +
          "Data Management → CSV Import → Correct if you need them back.",
      );
      router.refresh();
    } finally {
      setIsBusy(false);
      setIsScanning(false);
    }
  }

  /**
   * Re-reads the entry that is open, after an edit was saved.
   *
   * The modal stays open on the freshly-saved entry rather than closing: an edit
   * made while reviewing a date is usually one of several, and closing would
   * send the reader back to re-find the row. The grid behind it is reloaded too
   * — an edit can change the entry's date, which moves it to another group or
   * out of the list entirely (its old date may now hold only one entry).
   */
  async function reloadAfterEdit(entryId: number) {
    setIsBusy(true);
    setScanLabel({
      message: "Saving and re-reading the list…",
      detail: "An edit can move an entry to another date, so the whole list is regrouped.",
    });
    setIsScanning(true);
    try {
      const [entryResult, dataResult] = await Promise.all([
        getJournalSameDateEntryAction(entryId),
        loadJournalSameDateDataAction(logOnly),
      ]);
      if (dataResult.ok && dataResult.groups) setGroups(dataResult.groups);
      // A saved edit that moved the entry off a grouped date leaves it with no
      // row here. Showing it is still correct — it is what was just written —
      // so only a failed read closes the modal.
      if (entryResult.ok && entryResult.entry) {
        setOpenEntry(entryResult.entry);
      } else {
        setOpenEntry(undefined);
      }
      setIsEditing(false);
      setNotice("Saved your changes to that entry.");
      // The Entries list and the module chrome are stale now.
      router.refresh();
    } finally {
      setIsBusy(false);
      setIsScanning(false);
    }
  }

  async function runDelete(pending: PendingDelete) {
    setIsBusy(true);
    setScanLabel({
      message: `Moving ${pending.ids.length} ${plural(pending.ids.length)} to the recycle bin…`,
      detail: "Restorable afterwards from Data Management → CSV Import → Correct.",
    });
    setIsScanning(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await recycleJournalSameDateEntriesAction(pending.ids, logOnly);
      if (!result.ok) {
        setError(result.error ?? "That didn't work.");
        return;
      }
      if (result.groups) setGroups(result.groups);
      // The ticks must not outlive the rows they referred to — after a delete
      // those rows have gone, and so has the rest of their date if only one
      // entry is left on it.
      pending.clearSelection();
      setPendingDelete(undefined);
      setNotice(
        `Moved ${result.movedCount} ${plural(result.movedCount ?? 0)} to the recycle bin` +
          `${result.skippedCount ? `, skipped ${result.skippedCount} that no longer existed` : ""}.`,
      );
      // The entry count in the module chrome and the Entries list are stale now.
      router.refresh();
    } finally {
      setIsBusy(false);
      setIsScanning(false);
    }
  }

  /**
   * Locks the ticked entries, which is what takes their date off this screen.
   *
   * The groups are replaced from the action's response for the same reason the
   * delete path does it: locked entries are dropped *before* grouping, so
   * locking two of a date's three entries removes the whole date, which a
   * locally-applied "hide the ticked rows" guess would get wrong.
   */
  async function runLock(pending: PendingLock) {
    setIsBusy(true);
    setScanLabel({
      message: `Locking ${pending.ids.length} ${plural(pending.ids.length)}…`,
      detail: "Locked entries are dropped before grouping, so the list is regrouped after.",
    });
    setIsScanning(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await lockJournalSameDateEntriesAction(pending.ids, logOnly);
      if (!result.ok) {
        setError(result.error ?? "That didn't work.");
        return;
      }
      if (result.groups) setGroups(result.groups);
      // The ticks referred to rows that have now gone from the list.
      pending.clearSelection();
      setPendingLock(undefined);
      const locked = result.lockedCount ?? 0;
      setNotice(
        locked === 0
          ? "Those entries were already locked — nothing changed."
          : `Locked ${locked} ${plural(locked)} and removed them from review` +
              `${result.skippedCount ? `, skipped ${result.skippedCount} already locked or missing` : ""}` +
              ". Unlock an entry from the Entries list to bring its date back.",
      );
      // The entry count in the module chrome and the Entries list are stale now.
      router.refresh();
    } finally {
      setIsBusy(false);
      setIsScanning(false);
    }
  }

  /**
   * Builds the merged draft and opens it in an editable entry form.
   *
   * Nothing is written by this — `buildJournalMergeDraftAction` only assembles a
   * proposal from the full source entries. The reader edits it and saves, which
   * creates one new entry and still leaves every source entry in place; only
   * then are they *offered* for deletion (`mergeCleanup`). That ordering is
   * deliberate: the originals are never removed until the merged entry is safely
   * written, so a merge abandoned or failed half way through cannot lose any
   * writing.
   */
  async function startMerge(ids: number[], clearSelection: () => void) {
    setIsBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await buildJournalMergeDraftAction(ids);
      if (!result.ok || !result.draft) {
        setError(result.error ?? "Failed to build the merged entry.");
        return;
      }
      // `mergedIds` is what the action actually read — never the raw selection,
      // which can include an id that has since gone. Falling back to `ids` only
      // covers an older action response shape.
      const sourceIds = result.mergedIds ?? ids;
      setMerge({
        draft: result.draft,
        sourceIds,
        sourceCount: result.mergedCount ?? sourceIds.length,
        clearSelection,
      });
    } finally {
      setIsBusy(false);
    }
  }

  const columns: DataGridColumn<SameDateRow>[] = [
    {
      key: "date",
      header: "Date",
      // Sorting on this keeps one day's entries adjacent, which is what makes a
      // flat grid readable as groups. It is the order the rows arrive in.
      render: (row) => (
        <span className="whitespace-nowrap">
          {row.date}
          <span className="ml-2 text-xs text-muted">
            {row.entryIndex} of {row.entryCount}
          </span>
        </span>
      ),
      value: (row) => row.date,
    },
    {
      key: "time",
      header: "Time",
      render: (row) => (
        <span className="whitespace-nowrap">
          {row.time || <span className="text-muted">no time</span>}
        </span>
      ),
      value: (row) => row.time,
    },
    {
      key: "title",
      header: "Title",
      // Untitled entries are kept on this screen (unlike the Duplicates card,
      // which groups by title and has to skip them), so the blank case is a real
      // row that needs to read as deliberate rather than as missing data.
      // The "L" badge marks a logged activity. It lives on the title rather than
      // in a column of its own: a whole column for one character would cost grid
      // width on every row to say nothing about most of them, and the thing the
      // reader is scanning is the title anyway. Matches the fixed-size circular
      // badge the home screen's Top Tags counts use.
      render: (row) => (
        <span className="flex items-center gap-1.5">
          {row.title.trim() === "" ? (
            <span className="italic text-muted">(untitled)</span>
          ) : (
            row.title
          )}
          {row.isLog && (
            <span
              title="Log entry — a logged activity"
              aria-label="Log entry"
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brass-soft font-mono text-[0.5rem] font-semibold leading-none text-brass-dark"
            >
              L
            </span>
          )}
          {row.isLocked && (
            <span
              title="Locked — unlock it before editing or overwriting"
              aria-label="Locked"
              role="img"
              className="flex shrink-0 items-center text-muted"
            >
              <TreeIcon name="lock" className="h-3 w-3" />
            </span>
          )}
        </span>
      ),
      // Sorts and searches on the title alone — the badge is a property of the
      // row, not part of its name, and folding an "L" into the sort key would
      // scatter the titles it is attached to.
      value: (row) => row.title,
    },
    {
      key: "excerpt",
      header: "Content",
      // Reading the content is how you decide whether two entries on one day
      // belong together, so this is the widest column and it is searchable.
      render: (row) =>
        row.excerpt === "" ? <span className="italic text-muted">(no content)</span> : row.excerpt,
      value: (row) => row.excerpt,
      className: "max-w-xl",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Covers the viewport, the open entry modal included, while the list is
          re-read. Rendered here rather than inside the card so the dim reaches
          the whole page — see the note at the top of busy-overlay.tsx. */}
      <BusyOverlay isBusy={isScanning} message={scanLabel.message} detail={scanLabel.detail} />

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-muted">{notice}</p>}

      <CollapsibleCard
        title="Review multiple entries on same date"
        titleIcon={<SlotIcon slot={SAME_DATE_SLOT} className="h-4 w-4" />}
        defaultOpen
        // `headerAction`, so the lens sits on the title line and stays visible
        // whether the card is open or shut — and outside the collapse toggle, so
        // flipping it doesn't also close the card.
        headerAction={
          <label className="flex items-center gap-2 text-xs text-muted max-lg:text-[11px]">
            <input
              type="checkbox"
              checked={logOnly}
              disabled={isBusy}
              onChange={(event) => void toggleLogOnly(event.target.checked)}
            />
            {/* `whitespace-nowrap` so the label can't wrap mid-phrase into the
                chevron on a narrow header. */}
            <span className="whitespace-nowrap">Review only Log entries</span>
          </label>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">
            {logOnly
              ? "Every date carrying more than one Log entry — logged activities only, and a date needs two or more of them to appear here. "
              : "Every date carrying more than one entry, whatever the entries are called — the time of day is ignored. "}
            Click a row to read the whole entry, <strong>Edit</strong>
            it there if it needs fixing, and close it to come back here. Tick several, then{" "}
            <strong>Delete</strong> moves them to the recycle bin
            (recoverable under CSV Import → Correct), <strong>Merge</strong> drafts one new
            entry from them for you to edit and save — then asks whether to delete the
            originals — or <strong>Lock &amp; exclude from review</strong> marks them settled
            and takes them off this list for good. Locked entries never appear here, so a
            date left with fewer than two unlocked entries drops out entirely; unlock one
            from the Entries list to bring its date back.
          </p>
          {groups.length > 0 && (
            <p className="text-xs text-muted">
              {groups.length} {groups.length === 1 ? "date" : "dates"} · {entryCount}{" "}
              {logOnly ? "Log entries" : "entries"}.
            </p>
          )}

          <DataGrid
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.id}
            // Bands the zebra stripe by date rather than by row: every entry on
            // one date shares a shade and the next date takes the other, so a
            // group reads as a block in a flat list. Follows the order on screen,
            // so sorting by Title (which scatters a date) correctly falls back to
            // striping per row.
            getRowGroupKey={(row) => row.date}
            // A stronger stripe than the app-wide default, because here it marks
            // a whole date block rather than separating one row from the next:
            // across three rows the usual 94% mix is too faint to read as a band.
            // Mixed toward `--ink`, so it darkens a light theme and lightens a
            // dark one — see design.md, "The token system, not literal colors".
            stripeClassName="bg-[color-mix(in_srgb,var(--paper-raised)_88%,var(--ink))]"
            emptyMessage={
              logOnly
                ? "No date has more than one Log entry."
                : "No date has more than one entry."
            }
            exportFileName="journal-same-date-entries"
            storageKey="journal-same-date-grid"
            enableSelection
            onRowClick={(row) => void openEntryById(row.id)}
            // The viewer modal is the record view here: it renders an entry
            // properly, which the generic record read-out can't.
            enableRecordView={false}
            renderSelectionActions={(selectedRows, clearSelection) => (
              <>
                <Button
                  size="sm"
                  disabled={isBusy}
                  onClick={() => void startMerge(selectedRows.map((row) => row.id), clearSelection)}
                >
                  Merge checked
                </Button>
                {/* Sits between Merge and Delete deliberately: it is the
                    "I'm done with these" action, non-destructive, and keeping
                    the destructive Delete last leaves it hardest to mis-click. */}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isBusy}
                  onClick={() =>
                    setPendingLock({
                      ids: selectedRows.map((row) => row.id),
                      clearSelection,
                    })
                  }
                >
                  Lock &amp; exclude from review
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={isBusy}
                  onClick={() =>
                    setPendingDelete({
                      ids: selectedRows.map((row) => row.id),
                      clearSelection,
                    })
                  }
                >
                  Delete checked
                </Button>
              </>
            )}
          />
        </div>
      </CollapsibleCard>

      {openEntry && (
        <Modal
          title={openEntry.title.trim() === "" ? "Journal entry" : openEntry.title}
          description={isEditing ? "Editing this entry." : undefined}
          size="lg"
          isBusy={isBusy}
          onClose={() => {
            setOpenEntry(undefined);
            setIsEditing(false);
          }}
        >
          {/* Read or edit, in the same modal. Both halves are the components the
              single-entry screen uses, so an entry is read and written the same
              way whether you reached it from here or from /entries/[id] — the
              viewer's own Edit button is what switches between them, and it
              disables itself on a locked entry (updateEntry would reject one). */}
          {isEditing ? (
            <JournalEntryEditForm
              entry={openEntry}
              categoryOptions={categoryOptions}
              tagOptions={tagOptions}
              locationCategoryOptions={locationCategoryOptions}
              locationTagOptions={locationTagOptions}
              onCancel={() => setIsEditing(false)}
              onSaved={() => void reloadAfterEdit(openEntry.id)}
            />
          ) : (
            <JournalViewer
              entry={openEntry}
              categoryIcons={categoryIcons}
              tagIcons={tagIcons}
              categoryHref={(name) => journalEntriesFilterHref("category", name)}
              tagHref={(name) => journalEntriesFilterHref("tag", name)}
              onEdit={() => setIsEditing(true)}
            />
          )}
        </Modal>
      )}

      {merge && (
        <Modal
          title={`Merge ${merge.sourceCount} ${plural(merge.sourceCount)}`}
          description={
            "This is a draft — nothing has been saved and none of the original entries have " +
            "been touched. Edit it as you like, then save it to create one new entry. You'll " +
            "be asked afterwards whether to delete the originals."
          }
          size="lg"
          onClose={() => setMerge(undefined)}
        >
          {/* The same form the New Journal Entry section uses, seeded with the
              draft. Reused rather than rebuilt so the merged entry gets the
              location picker, the weather fetch, the handwriting sheet and the
              fullscreen editor for free — and so a change to how an entry is
              written lands on both screens at once. */}
          <JournalEntryForm
            categoryOptions={categoryOptions}
            tagOptions={tagOptions}
            preferences={preferences}
            prefillTemplates={prefillTemplates}
            locationCategoryOptions={locationCategoryOptions}
            locationTagOptions={locationTagOptions}
            initialValues={merge.draft}
            saveLabel="Save merged entry"
            // Writing the merged entry is a long write behind a dialog whose
            // only other signal is the Save button's label. The form owns the
            // flag and only reports it here.
            onSavingChange={(saving) => {
              if (saving) {
                setScanLabel({
                  message: "Saving the merged entry…",
                  detail: "The original entries are left untouched until you choose.",
                });
              }
              setIsScanning(saving);
            }}
            onSaved={() => {
              // The new entry lands on the same date as its sources, so that date
              // now has one more entry, not one fewer — the list has to be
              // re-read rather than patched. `router.refresh()` (fired by the
              // form) re-runs the server panel, and the ticks are dropped because
              // the rows behind them have been re-numbered.
              merge.clearSelection();
              // Hand straight over to the cleanup offer, carrying the ids before
              // `merge` is cleared. The merged entry is written at this point, so
              // binning the originals is now safe to offer.
              setMergeCleanup({ sourceIds: merge.sourceIds });
              setMerge(undefined);
            }}
          />
        </Modal>
      )}

      {mergeCleanup && (
        <Modal
          title="Merged entry created successfully"
          description={
            `Would you like to delete the original ${mergeCleanup.sourceIds.length} ` +
            `${plural(mergeCleanup.sourceIds.length)} the merge was built from? They move ` +
            "to the recycle bin, so this can be undone."
          }
          onClose={() => {
            // Declining is a normal outcome, not a dismissal to recover from:
            // the merged entry is saved and the originals stay. Say both, so
            // closing this box never looks like the merge was lost.
            setMergeCleanup(undefined);
            setNotice("Merged entry saved. The originals are still here.");
          }}
          isBusy={isBusy}
          footer={
            <>
              <Button
                variant="secondary"
                disabled={isBusy}
                onClick={() => {
                  setMergeCleanup(undefined);
                  setNotice("Merged entry saved. The originals are still here.");
                }}
              >
                Keep them
              </Button>
              <Button
                variant="danger"
                disabled={isBusy}
                onClick={() => void runMergeCleanup(mergeCleanup.sourceIds)}
              >
                {isBusy ? "Working…" : `Delete ${mergeCleanup.sourceIds.length}`}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink">
            The merged entry has been saved. Deleting the originals moves{" "}
            {mergeCleanup.sourceIds.length} {plural(mergeCleanup.sourceIds.length)} to the
            recycle bin.
          </p>
        </Modal>
      )}

      {pendingLock && (
        <Modal
          title={`Lock ${pendingLock.ids.length} ${plural(pendingLock.ids.length)}?`}
          description={
            `Locking the checked ${pendingLock.ids.length} ${plural(pendingLock.ids.length)} ` +
            "takes them out of this review list, so you won't be shown them again. A date " +
            "left with fewer than two unlocked entries disappears from the list entirely. " +
            "Nothing is deleted — unlock an entry from the Entries list to bring it back."
          }
          onClose={() => setPendingLock(undefined)}
          isBusy={isBusy}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setPendingLock(undefined)}
                disabled={isBusy}
              >
                Cancel
              </Button>
              <Button disabled={isBusy} onClick={() => void runLock(pendingLock)}>
                {isBusy ? "Working…" : `Lock ${pendingLock.ids.length}`}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink">
            {pendingLock.ids.length} {plural(pendingLock.ids.length)} selected. Locked entries
            also can&apos;t be edited or overwritten by an import until you unlock them.
          </p>
        </Modal>
      )}

      {pendingDelete && (
        <Modal
          title={`Delete ${pendingDelete.ids.length} ${plural(pendingDelete.ids.length)}?`}
          description={
            `Are you sure you want to delete the checked ${pendingDelete.ids.length} ` +
            `${plural(pendingDelete.ids.length)}? They move to the recycle bin under ` +
            "Data Management → CSV Import → Correct, so this can be undone."
          }
          onClose={() => setPendingDelete(undefined)}
          isBusy={isBusy}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setPendingDelete(undefined)}
                disabled={isBusy}
              >
                Cancel
              </Button>
              <Button variant="danger" disabled={isBusy} onClick={() => void runDelete(pendingDelete)}>
                {isBusy ? "Working…" : `Delete ${pendingDelete.ids.length}`}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink">
            {pendingDelete.ids.length} {plural(pendingDelete.ids.length)} selected.
          </p>
        </Modal>
      )}
    </div>
  );
}

/**
 * A pending delete: the ids *and* the grid's `clearSelection`, held across the
 * confirm dialog so it acts on exactly what was ticked when it opened and can
 * drop those ticks once the write lands.
 */
interface PendingDelete {
  ids: number[];
  clearSelection: () => void;
}

/**
 * A pending "Lock & exclude from review", held across its confirm dialog.
 *
 * Same shape and same reasoning as `PendingDelete` — the ids are captured when
 * the dialog opens so it acts on exactly what was ticked then, and the grid's
 * `clearSelection` rides along because the locked rows leave the list once the
 * write lands. A separate state from `pendingDelete` so the two confirmations
 * can never be on screen at once or act on each other's selection.
 */
interface PendingLock {
  ids: number[];
  clearSelection: () => void;
}

/** An open merge dialog: the draft being edited, and how it got there. */
interface PendingMerge {
  draft: MergedEntryDraft;
  /**
   * The entries the draft was built from — the ids the action actually read,
   * not everything the reader ticked. Kept so the post-save prompt can offer to
   * bin exactly the entries whose content ended up in the merged entry.
   */
  sourceIds: number[];
  sourceCount: number;
  clearSelection: () => void;
}

/**
 * The "delete the originals?" offer, shown once a merged entry is safely saved.
 *
 * Separate state from `PendingMerge` because it outlives it: the merge dialog
 * closes on save and this takes its place, so the two are never on screen
 * together. It carries its own copy of the ids rather than reading them back
 * off `merge`, which by then is gone.
 */
interface PendingMergeCleanup {
  sourceIds: number[];
}

function plural(count: number): string {
  return count === 1 ? "entry" : "entries";
}
