"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
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
  const [merge, setMerge] = useState<PendingMerge | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);

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
    try {
      const [entryResult, dataResult] = await Promise.all([
        getJournalSameDateEntryAction(entryId),
        loadJournalSameDateDataAction(),
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
    }
  }

  async function runDelete(pending: PendingDelete) {
    setIsBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await recycleJournalSameDateEntriesAction(pending.ids);
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
    }
  }

  /**
   * Builds the merged draft and opens it in an editable entry form.
   *
   * Nothing is written by this — `buildJournalMergeDraftAction` only assembles a
   * proposal from the full source entries. The reader edits it and saves, which
   * creates one new entry and leaves every source entry untouched; removing the
   * originals is then a separate, explicit Delete. That ordering is deliberate:
   * a merge abandoned half way through cannot lose any writing.
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
      setMerge({ draft: result.draft, sourceCount: result.mergedCount ?? ids.length, clearSelection });
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
        <span className="flex items-center gap-1 whitespace-nowrap">
          {row.time || <span className="text-muted">no time</span>}
          {row.isLocked && <TreeIcon name="shield" className="h-3 w-3" />}
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
      render: (row) =>
        row.title.trim() === "" ? <span className="italic text-muted">(untitled)</span> : row.title,
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
      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-muted">{notice}</p>}

      <CollapsibleCard
        title="Review multiple entries on same date"
        titleIcon={<SlotIcon slot={SAME_DATE_SLOT} className="h-4 w-4" />}
        defaultOpen
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">
            Every date carrying more than one entry, whatever the entries are called — the
            time of day is ignored. Click a row to read the whole entry, <strong>Edit</strong>
            it there if it needs fixing, and close it to come back here. Tick several, then{" "}
            <strong>Delete</strong> moves them to the recycle bin
            (recoverable under CSV Import → Correct), or <strong>Merge</strong> drafts one new
            entry from them for you to edit and save, leaving the originals in place.
          </p>
          {groups.length > 0 && (
            <p className="text-xs text-muted">
              {groups.length} {groups.length === 1 ? "date" : "dates"} · {entryCount} entries.
            </p>
          )}

          <DataGrid
            columns={columns}
            rows={rows}
            getRowKey={(row) => row.id}
            emptyMessage="No date has more than one entry."
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
              // A modal is a narrow box on a wide screen, which `max-lg:` can't
              // detect — without this the category and tag create fields are
              // squeezed to nothing here while the viewport is plainly desktop.
              isCompactContainer
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
            "been touched. Edit it as you like, then save it to create one new entry. Delete " +
            "the originals afterwards if you want them gone."
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
            // Same narrow-container problem as the edit form above: this is a
            // modal, so the pickers' create fields need their own line.
            isCompactContainer
            onSaved={() => {
              // The new entry lands on the same date as its sources, so that date
              // now has one more entry, not one fewer — the list has to be
              // re-read rather than patched. `router.refresh()` (fired by the
              // form) re-runs the server panel, and the ticks are dropped because
              // the rows behind them have been re-numbered.
              merge.clearSelection();
              setMerge(undefined);
              setNotice(
                `Saved a new entry merged from ${merge.sourceCount} ${plural(merge.sourceCount)}. ` +
                  "The originals are still here — delete them if you no longer want them.",
              );
            }}
          />
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

/** An open merge dialog: the draft being edited, and how it got there. */
interface PendingMerge {
  draft: MergedEntryDraft;
  sourceCount: number;
  clearSelection: () => void;
}

function plural(count: number): string {
  return count === 1 ? "entry" : "entries";
}
