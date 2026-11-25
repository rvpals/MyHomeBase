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
import type { DashboardTextureItem } from "@/lib/dashboard-texture";
import {
  ENCRYPTED_TITLE_PLACEHOLDER,
  displayEntryTitle,
  toDuplicateRows,
} from "@/lib/journal";
import type {
  DuplicateGroup,
  DuplicateRow,
  JournalEntry,
  JournalPreferences,
  JournalPrefillTemplate,
  JournalTaxonomyCombo,
  RecycledJournalEntry,
} from "@/lib/journal";
import {
  deleteRecycledForeverAction,
  emptyRecycleBinAction,
  getJournalEntryAction,
  loadJournalCorrectDataAction,
  restoreJournalEntriesAction,
} from "./journal-correct-actions";
import { JournalEntryFullViewer } from "./journal-entry-full-viewer";
import { JournalEntriesGrid } from "./journal-entries-grid";
import { journalEntriesFilterHref } from "./journal-shared";

const DUPLICATES_SLOT = getIconSlot("journal_card_duplicates")!;
const RECYCLED_SLOT = getIconSlot("journal_card_recycled_entries")!;

/**
 * Which cards to render.
 *
 * `"duplicates"` is the Duplicate entries section and `"recycled"` is the Recycle
 * Bin section — one card each. `"both"` renders the pair, which is what the Correct
 * tab under CSV Import did; no call site passes it since that tab was retired, and
 * it is kept because the two cards still share this file's state and dialogs.
 *
 * **If you ever put both cards on one screen again**, note that the two no longer
 * refresh together: the Duplicates grid's writes go through the shared bulk
 * actions, which re-read the duplicate rows and nothing else, so a delete there
 * would leave the bin card below it a list behind. That is harmless while each
 * card is its own section — nothing stale is on screen — and it is the price of
 * the Duplicates card offering the same seven actions as the Entries list rather
 * than a Delete of its own.
 */
export type JournalCorrectViewMode = "both" | "duplicates" | "recycled";

export interface JournalCorrectViewProps {
  duplicateGroups: DuplicateGroup[];
  recycledEntries: RecycledJournalEntry[];
  categoryIcons: Record<string, string>;
  tagIcons: Record<string, string>;
  /** Defaults to `"both"` — both cards, the arrangement this view was written for. */
  show?: JournalCorrectViewMode;
  /**
   * Clips attached per entry id, for the Title cell's paperclip. Absent ids have
   * none — the count query omits them rather than returning zeros.
   */
  clipCounts: Record<number, number>;
  /**
   * What the duplicates grid's Bulk edit, Bulk overwrite and Merge dialogs need.
   *
   * Required even for `show="recycled"`, which never draws that grid: these are
   * a handful of small lookups, and making them optional would mean either a
   * non-null assertion here or a second shape for the same props. The read this
   * screen actually has to be careful about — grouping every entry in the
   * journal — is the one the panel skips.
   */
  categoryOptions: string[];
  tagOptions: string[];
  locationCategoryOptions: string[];
  locationTagOptions: string[];
  preferences: JournalPreferences;
  contentTextures?: DashboardTextureItem[];
  prefillTemplates: JournalPrefillTemplate[];
  /** Saved taxonomy combos, for the opened entry's edit form. */
  taxonomyCombos?: JournalTaxonomyCombo[];
  /** Whether this reader has the Expense module — the opened entry's $ button. */
  canSeeExpense?: boolean;
}

/**
 * Find duplicate entries and act on them, then restore or purge what those
 * actions produced.
 *
 * Two call sites, one component (see `show`): the Duplicate entries section
 * renders the first card and the Recycle Bin section the second. They were one
 * screen — the Correct tab under CSV Import — until each got a name of its own
 * in the nav.
 *
 * **The Duplicates card is the Entries list's grid**, not a grid of its own:
 * `JournalEntriesGrid` brings the same Date / Time / Title / Categories / Tags
 * columns, the same tick-boxes and the same seven bulk actions (Bulk edit, Bulk
 * overwrite, Lock, Unlock, Encrypt, Merge, Delete) that the List of Entries
 * offers. The one thing this screen adds is the leading "Duplicate of" column,
 * which carries each row's group and its "2 of 3" — the grid is flat, sortable
 * and paginated, so the grouping has to travel on the row (`toDuplicateRows`).
 *
 * Two consequences worth knowing before you use it:
 *
 *   * **Encrypt makes a row vanish.** `findDuplicateGroups` skips encrypted
 *     entries — their titles are blank, so nothing could tell whether they
 *     match — so sealing one drops it, and possibly its whole group, from the
 *     refreshed list. That is the honest result, not a bug.
 *   * **Delete bins, it does not destroy.** It is the same delete the Entries
 *     list runs; the entries land in the Recycle Bin section.
 *
 * The Recycle Bin card keeps its own plain `DataGrid`: its rows are
 * `RecycledJournalEntry`, which is not a live entry and cannot be edited,
 * locked, encrypted or merged.
 */
export function JournalCorrectView({
  duplicateGroups: initialGroups,
  recycledEntries: initialRecycled,
  categoryIcons,
  tagIcons,
  show = "both",
  clipCounts,
  categoryOptions,
  tagOptions,
  locationCategoryOptions,
  locationTagOptions,
  preferences,
  contentTextures,
  prefillTemplates,
  taxonomyCombos = [],
  canSeeExpense = false,
}: JournalCorrectViewProps) {
  const router = useRouter();
  // Rows, not groups. Both writers produce rows: the bulk grid hands back
  // `DuplicateRow`s straight from the server (`{ tab: "duplicates" }`), and the
  // bin's actions hand back groups, which are flattened on arrival. One piece of
  // state so the two can never disagree about what is on screen.
  const [duplicateRows, setDuplicateRows] = useState(() => toDuplicateRows(initialGroups));
  const [recycled, setRecycled] = useState(initialRecycled);

  const [openEntry, setOpenEntry] = useState<
    { entry: JournalEntry; isRecycled: boolean } | undefined
  >(undefined);
  const [confirm, setConfirm] = useState<PendingConfirm | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);

  /**
   * Runs one of the Recycle Bin's actions and adopts the lists it returns.
   *
   * `clearSelection` is the bin grid's own callback, held across the confirm
   * dialog on purpose — components.md's warning is that the ticks must not
   * outlive the rows they referred to, and after a restore or a purge those rows
   * are gone.
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
      if (result.duplicateGroups) setDuplicateRows(toDuplicateRows(result.duplicateGroups));
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
   * The duplicate rows carry whole entries **minus their body** (see
   * src/lib/journal/duplicates.ts), so the full entry is fetched on click rather
   * than shipped with the list — the card can hold hundreds of rows. The bin's
   * rows are complete already and open with no round trip.
   */
  /**
   * Re-reads both cards after an edit saved inside the full viewer.
   *
   * `router.refresh()` is not enough: `duplicateRows` is client state seeded
   * from props once, so a server re-render never reaches it. An edit can also
   * change the date or title that made two entries a pair, which should drop
   * both rows — only a re-group can know that.
   */
  async function refreshDuplicates() {
    const result = await loadJournalCorrectDataAction();
    if (!result.ok) {
      setError(result.error ?? "Saved, but the list could not be re-read.");
      return;
    }
    if (result.duplicateGroups) setDuplicateRows(toDuplicateRows(result.duplicateGroups));
    if (result.recycledEntries) setRecycled(result.recycledEntries);
    // The entry count in the module chrome and the Entries list are stale too.
    router.refresh();
  }

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

  /**
   * The one column this screen adds in front of the shared entry columns.
   *
   * Sorting on it keeps copies of one entry adjacent, which is what makes a flat
   * grid readable as groups. No lock glyph here — the shared Title column
   * already marks a locked or encrypted entry, and two locks on one row read as
   * two different facts.
   */
  const groupColumn: DataGridColumn<DuplicateRow> = {
    key: "group",
    header: "Duplicate of",
    render: (row) => (
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        {row.groupKey}
        <span className="ml-2 text-xs text-muted">
          {row.copyIndex} of {row.copyCount}
        </span>
      </span>
    ),
    value: (row) => row.groupKey,
  };

  const recycledColumns: DataGridColumn<RecycledJournalEntry>[] = [
    {
      key: "title",
      header: "Title",
      // A binned entry can be encrypted (migration 0131) -- its ciphertext moved
      // into the bin with it, so the row shows the placeholder rather than the
      // blank title column.
      render: (entry) =>
        entry.isEncrypted ? (
          <span className="italic text-muted">{ENCRYPTED_TITLE_PLACEHOLDER}</span>
        ) : entry.title.trim() === "" ? (
          <span className="italic text-muted">(untitled)</span>
        ) : (
          entry.title
        ),
      value: (entry) => displayEntryTitle(entry.title, entry.isEncrypted),
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

      {show !== "recycled" && (
        <CollapsibleCard
          title="Duplicates"
          titleIcon={<SlotIcon slot={DUPLICATES_SLOT} className="h-4 w-4" />}
          defaultOpen
        >
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted">
              Entries sharing a date and a title — including ones written at different times of
              the same day. Click a row to read the whole entry, then tick the copies you want to
              act on: the buttons are the same ones the List of Entries offers. Delete moves
              entries to the Recycle Bin section rather than destroying them, and Encrypt removes
              a row from this list, because a sealed entry has no readable title to match on.
            </p>

            <JournalEntriesGrid<DuplicateRow>
              rows={duplicateRows}
              // No filter and no cap: duplicate detection is a whole-journal
              // question, so the server re-groups every entry after each write.
              scope={() => ({ tab: "duplicates" })}
              onRowsChanged={(rows, message) => {
                setDuplicateRows(rows);
                setNotice(message);
                setError(undefined);
              }}
              onError={setError}
              onNotice={setNotice}
              onBusyChange={setIsBusy}
              // The viewer modal rather than the entry screen: comparing copies
              // means opening one, closing it and opening the next, and a
              // navigation would drop the ticks each time.
              onRowClick={(row) => void openLiveEntry(row.id)}
              clipCounts={clipCounts}
              leadingColumns={[groupColumn]}
              // Bands the zebra stripe by group, so a set of copies reads as a
              // block. It follows the order on screen, so sorting by another
              // column correctly goes back to one stripe per row.
              getRowGroupKey={(row) => row.groupKey}
              stripeClassName="bg-[color-mix(in_srgb,var(--paper-raised)_88%,var(--ink))]"
              emptyMessage="No duplicate entries found."
              exportFileName="journal-duplicates"
              // Its own key, not the Entries list's: this grid has a column the
              // other doesn't, so sharing one would let a hidden-column set made
              // here change that screen.
              storageKey="myhomebase:journal-duplicates-grid"
              formOptions={{
                categoryOptions,
                tagOptions,
                locationCategoryOptions,
                locationTagOptions,
                preferences,
                contentTextures,
                prefillTemplates,
              }}
            />
          </div>
        </CollapsibleCard>
      )}

      {show !== "duplicates" && (
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
              // The viewer modal is the record view here: it renders an entry
              // properly, which the generic record read-out can't.
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
      )}

      {/* A **live** entry opens in the shared full viewer: editable, with the
          whole toolbar. Finding a duplicate is exactly when you want to fix one
          of the pair rather than only look at it.

          A **recycled** one does not. It has no live row — Edit, Lock and
          Encrypt would all fail against it — so it keeps the read-only
          `JournalViewer` below. That is why that component stays registered and
          separate: "render an entry" and "render an entry you can act on" are
          two jobs, and the bin only has the first. */}
      {openEntry && !openEntry.isRecycled && (
        <JournalEntryFullViewer
          mode="modal"
          entry={openEntry.entry}
          categoryIcons={categoryIcons}
          tagIcons={tagIcons}
          categoryOptions={categoryOptions}
          tagOptions={tagOptions}
          taxonomyCombos={taxonomyCombos}
          locationCategoryOptions={locationCategoryOptions}
          locationTagOptions={locationTagOptions}
          preferences={preferences}
          contentTextures={contentTextures}
          canSeeExpense={canSeeExpense}
          // These rows are client state seeded from props once, so a server
          // refresh would not touch them — and an edit can break the date+title
          // match that made the pair duplicates, which should drop both rows.
          onSaved={() => void refreshDuplicates()}
          onClose={() => setOpenEntry(undefined)}
        />
      )}

      {openEntry?.isRecycled && (
        <Modal
          // The deleted marker goes in the title because that is the one line
          // always visible in the modal — an entry read out of the bin must not
          // look like a live one.
          title={`[DELETED] ${
            openEntry.entry.isEncrypted
              ? ENCRYPTED_TITLE_PLACEHOLDER
              : openEntry.entry.title.trim() === ""
                ? "Journal entry"
                : openEntry.entry.title
          }`}
          description="This entry is in the recycle bin."
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
 * A pending confirmation for one of the **Recycle Bin's** actions.
 *
 * The Duplicates card has no entry here: its dialogs — including its Delete
 * confirm — belong to `JournalEntriesGrid`, so this covers only what the bin
 * does on its own.
 *
 * The selection-based kinds carry the ids *and* the grid's `clearSelection`, so
 * the dialog acts on exactly what was ticked when it opened and can drop those
 * ticks once the write lands. "Empty the bin" carries only a count — it isn't a
 * selection, it takes everything.
 */
type PendingConfirm =
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
    case "restore":
      return `Restore ${count}`;
    case "purge":
      return `Delete ${count} forever`;
    case "empty":
      return "Empty the bin";
  }
}
