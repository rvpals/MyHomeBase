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
import { toDuplicateRows } from "@/lib/journal";
import type {
  DuplicateGroup,
  DuplicateRow,
  JournalEntry,
  RecycledJournalEntry,
} from "@/lib/journal";
import {
  deleteRecycledForeverAction,
  emptyRecycleBinAction,
  getJournalEntryAction,
  recycleJournalEntriesAction,
  restoreJournalEntriesAction,
} from "./journal-correct-actions";
import { journalEntriesFilterHref } from "./journal-shared";

const DUPLICATES_SLOT = getIconSlot("journal_card_duplicates")!;
const RECYCLED_SLOT = getIconSlot("journal_card_recycled_entries")!;

export interface JournalCorrectViewProps {
  duplicateGroups: DuplicateGroup[];
  recycledEntries: RecycledJournalEntry[];
  categoryIcons: Record<string, string>;
  tagIcons: Record<string, string>;
}

/**
 * The Correct tab: find duplicate entries and delete the redundant ones, then
 * restore or purge what those deletes produced.
 *
 * Both lists are `DataGrid`s — the registered result grid, which brings paging,
 * search, per-column filters, selection pruned to the filtered set, CSV export
 * and the below-1024px card layout. The duplicate groups are flattened to rows
 * for it (`toDuplicateRows`), with each row carrying its group's identity and
 * "n of m", so a set of copies still reads as a set in a flat sortable list.
 *
 * Both cards' data is held in one piece of state and replaced wholesale by every
 * action's response. A delete moves an entry from one card to the other, so
 * patching the lists locally would leave the two disagreeing about where it
 * went — the server's answer is the only version that is coherent.
 */
export function JournalCorrectView({
  duplicateGroups: initialGroups,
  recycledEntries: initialRecycled,
  categoryIcons,
  tagIcons,
}: JournalCorrectViewProps) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [recycled, setRecycled] = useState(initialRecycled);

  const [openEntry, setOpenEntry] = useState<
    { entry: JournalEntry; isRecycled: boolean } | undefined
  >(undefined);
  const [confirm, setConfirm] = useState<PendingConfirm | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);

  const duplicateRows = toDuplicateRows(groups);

  /**
   * Runs an action, adopts the lists it returns, and clears the grid's ticks.
   *
   * `clearSelection` is the grid's own callback, held across the confirm dialog
   * on purpose — components.md's warning is that the ticks must not outlive the
   * rows they referred to, and after any of these operations those rows have
   * either gone or moved to the other grid.
   */
  async function run(
    action: () => Promise<{
      ok: boolean;
      error?: string;
      duplicateGroups?: DuplicateGroup[];
      recycledEntries?: RecycledJournalEntry[];
    }>,
    describe: (result: Record<string, unknown>) => string,
    clearSelection?: () => void,
  ) {
    setIsBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "That didn't work.");
        return;
      }
      if (result.duplicateGroups) setGroups(result.duplicateGroups);
      if (result.recycledEntries) setRecycled(result.recycledEntries);
      clearSelection?.();
      setConfirm(undefined);
      setNotice(describe(result as Record<string, unknown>));
      // The entry count in the module chrome and the Entries list are stale now.
      router.refresh();
    } finally {
      setIsBusy(false);
    }
  }

  /**
   * Opens a live entry in the viewer.
   *
   * The Duplicates rows only carry a 100-word excerpt, so the full entry is
   * fetched on click rather than shipped with the list — see
   * getJournalEntryAction. The bin's rows are complete already and open with no
   * round trip.
   */
  async function openLiveEntry(entryId: number) {
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await getJournalEntryAction(entryId);
      if (!result.ok || !result.entry) {
        setError(result.error ?? "Failed to open that entry.");
        return;
      }
      setOpenEntry({ entry: result.entry, isRecycled: false });
    } finally {
      setIsBusy(false);
    }
  }

  const duplicateColumns: DataGridColumn<DuplicateRow>[] = [
    {
      key: "group",
      header: "Duplicate of",
      // Sorting on this keeps copies of one entry adjacent, which is what makes
      // a flat grid readable as groups.
      render: (row) => (
        <span className="whitespace-nowrap">
          {row.groupKey}
          <span className="ml-2 text-xs text-muted">
            {row.copyIndex} of {row.copyCount}
          </span>
        </span>
      ),
      value: (row) => row.groupKey,
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
      key: "excerpt",
      header: "Content",
      // Reading the content is how you tell two same-titled entries apart, so
      // this is the widest column and it is searchable.
      render: (row) =>
        row.excerpt === "" ? <span className="italic text-muted">(no content)</span> : row.excerpt,
      value: (row) => row.excerpt,
      className: "max-w-xl",
    },
    {
      key: "created",
      header: "Written",
      render: (row) => <span className="whitespace-nowrap">{row.createdAt}</span>,
      value: (row) => row.createdAt,
    },
  ];

  const recycledColumns: DataGridColumn<RecycledJournalEntry>[] = [
    {
      key: "title",
      header: "Title",
      render: (entry) =>
        entry.title.trim() === "" ? (
          <span className="italic text-muted">(untitled)</span>
        ) : (
          entry.title
        ),
      value: (entry) => entry.title,
    },
    {
      key: "date",
      header: "Date",
      render: (entry) => (
        <span className="whitespace-nowrap">
          {entry.date}
          {entry.time ? ` ${entry.time}` : ""}
        </span>
      ),
      value: (entry) => `${entry.date} ${entry.time}`.trim(),
    },
    {
      key: "deleted",
      header: "Deleted",
      render: (entry) => <span className="whitespace-nowrap">{entry.deletedAt}</span>,
      value: (entry) => entry.deletedAt,
    },
    {
      key: "tags",
      header: "Tags",
      render: (entry) => entry.tags.join(", "),
      value: (entry) => entry.tags.join(", "),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-muted">{notice}</p>}

      <CollapsibleCard
        title="Duplicates"
        titleIcon={<SlotIcon slot={DUPLICATES_SLOT} className="h-4 w-4" />}
        defaultOpen
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">
            Entries sharing a date and a title — including ones written at different times of
            the same day. Click a row to read the whole entry, tick the copies you don&apos;t
            want, and Delete moves them to the recycle bin below rather than destroying them.
          </p>

          <DataGrid
            columns={duplicateColumns}
            rows={duplicateRows}
            getRowKey={(row) => row.id}
            emptyMessage="No duplicate entries found."
            exportFileName="journal-duplicates"
            storageKey="journal-duplicates-grid"
            enableSelection
            onRowClick={(row) => void openLiveEntry(row.id)}
            // The viewer modal is the record view here: it renders an entry
            // properly, which the generic record read-out can't.
            enableRecordView={false}
            renderSelectionActions={(selectedRows, clearSelection) => (
              <Button
                size="sm"
                variant="danger"
                disabled={isBusy}
                onClick={() =>
                  setConfirm({
                    kind: "recycle",
                    ids: selectedRows.map((row) => row.id),
                    clearSelection,
                  })
                }
              >
                Delete checked
              </Button>
            )}
          />
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        title="Recycled Entries"
        titleIcon={<SlotIcon slot={RECYCLED_SLOT} className="h-4 w-4" />}
        headerAction={
          recycled.length > 0 ? (
            <button
              type="button"
              onClick={() => setConfirm({ kind: "empty", count: recycled.length })}
              disabled={isBusy}
              title="Empty the recycle bin"
              aria-label="Empty the recycle bin"
              className="rounded-md p-1 text-muted hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass"
            >
              <TreeIcon name="trash" className="h-4 w-4" />
            </button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">
            Deleted entries wait here. Restoring one puts it back with its categories, tags and
            locations. Deleting it forever cannot be undone.
          </p>

          <DataGrid
            columns={recycledColumns}
            rows={recycled}
            getRowKey={(entry) => entry.recycledId}
            emptyMessage="The recycle bin is empty."
            exportFileName="journal-recycle-bin"
            storageKey="journal-recycled-grid"
            enableSelection
            onRowClick={(entry) => setOpenEntry({ entry, isRecycled: true })}
            enableRecordView={false}
            renderSelectionActions={(selectedRows, clearSelection) => (
              <>
                <Button
                  size="sm"
                  disabled={isBusy}
                  onClick={() =>
                    setConfirm({
                      kind: "restore",
                      ids: selectedRows.map((entry) => entry.recycledId),
                      clearSelection,
                    })
                  }
                >
                  Restore entries
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={isBusy}
                  onClick={() =>
                    setConfirm({
                      kind: "purge",
                      ids: selectedRows.map((entry) => entry.recycledId),
                      clearSelection,
                    })
                  }
                >
                  Delete forever
                </Button>
              </>
            )}
          />
        </div>
      </CollapsibleCard>

      {openEntry && (
        <Modal
          // The deleted marker goes in the title because that is the one line
          // always visible in the modal — an entry read out of the bin must not
          // look like a live one.
          title={`${openEntry.isRecycled ? "[DELETED] " : ""}${
            openEntry.entry.title.trim() === "" ? "Journal entry" : openEntry.entry.title
          }`}
          description={openEntry.isRecycled ? "This entry is in the recycle bin." : undefined}
          size="lg"
          onClose={() => setOpenEntry(undefined)}
        >
          {/* The registered viewer, read-only: nothing here edits an entry, and a
              recycled one has no live row to edit. */}
          <JournalViewer
            entry={openEntry.entry}
            categoryIcons={categoryIcons}
            tagIcons={tagIcons}
            categoryHref={(name) => journalEntriesFilterHref("category", name)}
            tagHref={(name) => journalEntriesFilterHref("tag", name)}
          />
        </Modal>
      )}

      {confirm && (
        <Modal
          title={confirmTitle(confirm)}
          description={confirmDescription(confirm)}
          onClose={() => setConfirm(undefined)}
          isBusy={isBusy}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirm(undefined)} disabled={isBusy}>
                Cancel
              </Button>
              <Button
                variant={confirm.kind === "restore" ? "primary" : "danger"}
                disabled={isBusy}
                onClick={() => runConfirmed(confirm)}
              >
                {isBusy ? "Working…" : confirmActionLabel(confirm)}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink">
            {confirmCount(confirm)} {plural(confirmCount(confirm))} selected.
          </p>
        </Modal>
      )}
    </div>
  );

  function runConfirmed(pending: PendingConfirm) {
    switch (pending.kind) {
      case "recycle":
        void run(
          () => recycleJournalEntriesAction(pending.ids),
          (result) =>
            `Moved ${result.movedCount} ${
              result.movedCount === 1 ? "entry" : "entries"
            } to the recycle bin.`,
          pending.clearSelection,
        );
        return;
      case "restore":
        void run(
          () => restoreJournalEntriesAction(pending.ids),
          (result) =>
            `Restored ${result.restoredCount} ${result.restoredCount === 1 ? "entry" : "entries"}.`,
          pending.clearSelection,
        );
        return;
      case "purge":
        void run(
          () => deleteRecycledForeverAction(pending.ids),
          (result) =>
            `Deleted ${result.deletedCount} ${
              result.deletedCount === 1 ? "entry" : "entries"
            } forever.`,
          pending.clearSelection,
        );
        return;
      case "empty":
        void run(
          () => emptyRecycleBinAction(),
          (result) =>
            `Emptied the recycle bin — ${result.deletedCount} ${
              result.deletedCount === 1 ? "entry" : "entries"
            } gone.`,
        );
        return;
    }
  }
}

/**
 * A pending confirmation.
 *
 * The selection-based kinds carry the ids *and* the grid's `clearSelection`, so
 * the dialog acts on exactly what was ticked when it opened and can drop those
 * ticks once the write lands. "Empty the bin" carries only a count — it isn't a
 * selection, it takes everything.
 */
type PendingConfirm =
  | { kind: "recycle"; ids: number[]; clearSelection: () => void }
  | { kind: "restore"; ids: number[]; clearSelection: () => void }
  | { kind: "purge"; ids: number[]; clearSelection: () => void }
  | { kind: "empty"; count: number };

function confirmCount(pending: PendingConfirm): number {
  return pending.kind === "empty" ? pending.count : pending.ids.length;
}

function plural(count: number): string {
  return count === 1 ? "entry" : "entries";
}

function confirmTitle(pending: PendingConfirm): string {
  const count = confirmCount(pending);
  switch (pending.kind) {
    case "recycle":
      return `Remove the checked ${count} ${plural(count)}?`;
    case "restore":
      return `Restore ${count} ${plural(count)}?`;
    case "purge":
      return `Delete ${count} ${plural(count)} forever?`;
    case "empty":
      return `Empty the recycle bin — all ${count} ${plural(count)}?`;
  }
}

function confirmDescription(pending: PendingConfirm): string {
  const count = confirmCount(pending);
  switch (pending.kind) {
    case "recycle":
      return `Are you sure you want to remove the checked ${count} ${plural(
        count,
      )}? They move to the recycle bin below, so this can be undone.`;
    case "restore":
      return `Are you sure you want to restore ${count} ${plural(
        count,
      )}? Each one goes back with its categories, tags and locations.`;
    case "purge":
      return `Are you sure you want to delete ${count} ${plural(
        count,
      )} forever? This cannot be undone.`;
    case "empty":
      return `Are you sure you want to empty the recycle bin? All ${count} ${plural(
        count,
      )} will be deleted forever. This cannot be undone.`;
  }
}

function confirmActionLabel(pending: PendingConfirm): string {
  const count = confirmCount(pending);
  switch (pending.kind) {
    case "recycle":
      return `Remove ${count}`;
    case "restore":
      return `Restore ${count}`;
    case "purge":
      return `Delete ${count} forever`;
    case "empty":
      return "Empty the bin";
  }
}
