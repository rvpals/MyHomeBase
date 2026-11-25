"use client";

// **The** grid of journal entries — one column set, one action bar, one set of
// dialogs, shared by every screen that lists entries:
//
//   * the Entries section's four tabs and its Search Results tab
//     (journal-entries-view.tsx);
//   * Data Management → Duplicate entries (journal-correct-view.tsx).
//
// It exists because those screens had grown two hand-written copies of the same
// seven buttons and five dialogs, and the Duplicates card was about to be a
// third. The entries view's own docblock already warns about exactly this: the
// Log tab was once its own component and ended up with different columns, a
// different storage key and bulk actions missing Lock/Unlock/Encrypt. **If you
// are about to add a button here for one caller only, add a prop, not a second
// grid.**
//
// Props in, events out, with one exception that can't be: the bulk writes are
// server actions, so this component calls them itself and hands the caller back
// the refreshed rows. The caller still owns everything around the grid — its
// heading, its notice line, its filter card — and says via `scope` how the
// server should re-read its rows afterwards.
//
// Route-local, and deliberately not in `src/components/`: it imports the server
// actions in ./journal-bulk-actions, which the components registry forbids
// ("no data fetching, no lib imports beyond types"). Same shape and same reason
// as journal-merge-flow.tsx next door. It is listed in components.md anyway,
// flagged as the one route-local entry, because that file is where a session
// looks before building UI — see "The one route-local entry" there.
//
// ---------------------------------------------------------------------------
// Adding another journal screen to this grid
// ---------------------------------------------------------------------------
//
// 1. **Add an arm to `BulkRefreshScope`** (journal-bulk-actions.ts) naming your
//    screen, and teach `refresh()` how to re-read its rows. This is the step
//    that matters: borrow another screen's arm and every write hands you back
//    that screen's rows.
// 2. **Pass `scope` as a function** returning that arm — not a value, because it
//    has to be read at call time against whatever the reader has since changed.
// 3. **Supply `formOptions`.** Copy the reads from journal-correct-panel.tsx,
//    the smaller of the two examples.
// 4. **Pick a `storageKey`.** Reuse `myhomebase:journal-entries-grid` only if
//    your columns are exactly the shared set. Pass `leadingColumns` and you need
//    your own key, or a hidden column set made on one screen changes the other.
//
// `scope` and the `Row` type argument have to agree — see the note on `adopt`.
//
// **Not for other modules.** Rows are `JournalEntry`, the writes are the
// journal's actions, the refresh is `BulkRefreshScope`. A Documents or Expense
// grid shares none of that and wants `DataGrid` directly.

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { BulkConfirm } from "@/components/bulk-confirm";
import { BusyOverlay } from "@/components/busy-overlay";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { EncryptionPrompt } from "@/components/encryption-prompt";
import { SlotIcon } from "@/components/slot-icon";
import { getIconSlot } from "@/lib/icons";
import type { DashboardTextureItem } from "@/lib/dashboard-texture";
import {
  ENCRYPTED_TITLE_PLACEHOLDER,
  displayEntryTitle,
  type JournalEntry,
  type JournalPreferences,
  type JournalPrefillTemplate,
} from "@/lib/journal";
import {
  bulkEncryptJournalEntriesAction,
  bulkLockJournalEntriesAction,
  deleteJournalEntriesAction,
  type BulkRefreshScope,
} from "./journal-bulk-actions";
import { JournalMergeDialogs, useJournalMerge } from "./journal-merge-flow";
// Clips on a journal screen. The dialog lives in the Clips file group because
// Clips owns the concept — the Journal only has to know how to open it, and
// `src/lib/journal` still knows nothing about clips.
import { EntryClipsDialog } from "./clips-entry-clips-dialog";
import { JournalEntriesBulkEdit } from "./journal-entries-bulk-edit";
import { JournalEntriesBulkOverwrite } from "./journal-entries-bulk-overwrite";

// Resolved once at module scope; the registry is static, so this is not I/O.
// Migration 0131. The lock badge on an encrypted row's Title cell.
const ENCRYPTED_SLOT = getIconSlot("journal_entry_encrypted")!;
// Migration 0155. The paperclip on a row whose entry has clips attached. Owned by
// the Clips module's slot group, because it marks a clip wherever it appears.
const CLIP_SLOT = getIconSlot("clips_linked_badge")!;

/**
 * The one column set, shared by every screen that lists journal entries.
 *
 * **The default, and what every screen should start from.** Two tabs used to
 * have their own — the Substantial tab swapped Place for a Body Length column,
 * the Log tab had a merged "When" plus Source and Note — and the result read as
 * four different screens over the same table. A column that earns its place on
 * one screen generally earns it on all of them, so add it here; `DataGrid`
 * already lets a reader hide per grid what they don't want, and a screen with
 * something genuinely of its own (the Duplicates card's "Duplicate of") passes
 * it as `leadingColumns`.
 *
 * A screen whose question is genuinely different may pass its own `columns` —
 * the Today in history dialog does, trading Categories and Tags for the body
 * excerpt. **It must build that set from this array**, filtering and
 * concatenating rather than retyping Date / Time / Title, so those stay
 * byte-identical everywhere. A re-declared column is a column free to drift,
 * which is the whole failure above.
 */
export const JOURNAL_ENTRY_COLUMNS: DataGridColumn<JournalEntry>[] = [
  { key: "date", header: "Date", value: (entry) => entry.date, render: (entry) => entry.date },
  { key: "time", header: "Time", value: (entry) => entry.time, render: (entry) => entry.time },
  {
    key: "title",
    header: "Title",
    // An encrypted entry's title column is blank (migration 0131), so both the
    // sort value and the cell use the placeholder — otherwise every encrypted
    // row would sort together at the top under an empty string and read as a
    // set of untitled entries.
    value: (entry) => displayEntryTitle(entry.title, entry.isEncrypted),
    render: (entry) =>
      entry.isEncrypted ? (
        <span className="inline-flex items-center gap-1.5 text-muted">
          <SlotIcon slot={ENCRYPTED_SLOT} className="h-3.5 w-3.5" />
          {ENCRYPTED_TITLE_PLACEHOLDER}
        </span>
      ) : entry.isLocked ? (
        // A locked entry gets the lock in front of its title. Reuses the encrypted
        // entry's lock slot rather than a new id — one glyph for "can't be edited".
        <span className="inline-flex items-center gap-1.5">
          <SlotIcon slot={ENCRYPTED_SLOT} className="h-3.5 w-3.5 shrink-0 text-muted" />
          {entry.title}
        </span>
      ) : (
        entry.title
      ),
  },
  {
    key: "categories",
    header: "Categories",
    value: (entry) => entry.categories.join(", "),
    render: (entry) => entry.categories.join(", "),
  },
  {
    key: "tags",
    header: "Tags",
    value: (entry) => entry.tags.join(", "),
    render: (entry) => entry.tags.join(", "),
  },
];

/**
 * The shared columns, with a paperclip appended to the Title cell of any entry
 * carrying clips.
 *
 * A wrapper rather than a column in `JOURNAL_ENTRY_COLUMNS` because the counts
 * arrive as a prop and the array is a module-scope constant. Only the Title
 * column is replaced, so the two sets cannot drift — a new column added above is
 * picked up here for free.
 *
 * Module-private: every grid in the app goes through `JournalEntriesGrid`, which
 * applies this itself. A screen that needed its own columns array would be the
 * second grid this file exists to prevent.
 */
function withClipBadge<Row extends JournalEntry>(
  columns: DataGridColumn<Row>[],
  clipCounts: Record<number, number>,
  onOpenClips: (entryId: number) => void,
): DataGridColumn<Row>[] {
  return columns.map((column) =>
    column.key === "title"
      ? {
          ...column,
          render: (entry: Row) => {
            const count = clipCounts[entry.id] ?? 0;
            return (
              <span className="inline-flex items-center gap-1.5">
                {column.render?.(entry)}
                {count > 0 && (
                  <button
                    type="button"
                    // `stopPropagation` because the row has its own click (it opens
                    // the entry): without it the paperclip would open the entry
                    // behind the dialog it just raised.
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenClips(entry.id);
                    }}
                    className="inline-flex items-center gap-0.5 text-muted hover:text-ink"
                    title={`${count} clip${count === 1 ? "" : "s"} attached — open`}
                    aria-label={`Open the ${count} clip${count === 1 ? "" : "s"} on this entry`}
                  >
                    <SlotIcon slot={CLIP_SLOT} className="h-3.5 w-3.5" />
                    {count > 1 && <span className="text-xs">{count}</span>}
                  </button>
                )}
              </span>
            );
          },
        }
      : column,
  );
}

/** What the Merge action's entry form needs, supplied by the hosting screen. */
export interface JournalEntryFormOptions {
  categoryOptions: string[];
  tagOptions: string[];
  locationCategoryOptions: string[];
  locationTagOptions: string[];
  preferences: JournalPreferences;
  contentTextures?: DashboardTextureItem[];
  prefillTemplates: JournalPrefillTemplate[];
}

export interface JournalEntriesGridProps<Row extends JournalEntry> {
  /** The rows on screen. The caller owns them; this component never filters. */
  rows: Row[];
  /**
   * How the server should re-read this screen's rows after a write.
   *
   * A function, not a value: the scope depends on state the caller is still
   * changing (the selected filter, the search term), and reading it at call time
   * is what stops a write refreshing against a stale one.
   *
   * **It also decides the shape of what comes back** — `{ tab: "duplicates" }`
   * returns `DuplicateRow`s, every other arm returns plain entries. See the cast
   * in `adopt` below.
   */
  scope: () => BulkRefreshScope;
  /**
   * The server's refreshed rows and its one-line description of what happened.
   *
   * The rows are adopted wholesale rather than patched locally: a write can move
   * a row out of the list it was ticked in (locking from the Unlocked tab,
   * encrypting from the Duplicates card), and only the server's answer is
   * coherent about that.
   */
  onRowsChanged: (rows: Row[], message: string) => void;
  /** A failed action's message, or `undefined` to clear one. */
  onError: (message: string | undefined) => void;
  /**
   * Something happened that changed no rows — declining the Merge flow's offer
   * to bin the originals is the only one today. Separate from `onRowsChanged`
   * so the caller is never handed back the list it already has.
   */
  onNotice: (message: string) => void;
  /** Raised around every write, for the caller's own disabled states. */
  onBusyChange?: (isBusy: boolean) => void;
  /** What a click on a row does — open the entry's screen, or raise a viewer. */
  onRowClick: (row: Row) => void;
  /**
   * Clips attached per entry id, for the Title cell's paperclip. Absent ids have
   * none — the count query omits them rather than returning zeros.
   */
  clipCounts: Record<number, number>;
  /**
   * Columns placed **in front of** the shared set — for a screen with a genuine
   * extra dimension, like the Duplicates card's "Duplicate of".
   */
  leadingColumns?: DataGridColumn<Row>[];
  /**
   * The column set this screen shows, **replacing** `JOURNAL_ENTRY_COLUMNS`.
   * Omit it — as the Entries tabs, Search Results and the Duplicates card all do
   * — and the shared default is used unchanged.
   *
   * This exists because one screen genuinely reads differently: the Today in
   * history dialog answers "what else did I write on this date?", so it wants
   * the body text in view and has no use for Categories and Tags, which on that
   * screen are the same handful of values repeating down the page.
   *
   * **Build it from `JOURNAL_ENTRY_COLUMNS`, don't retype it.** Filtering and
   * concatenating the exported array keeps Date / Time / Title byte-identical to
   * every other screen's, which is the whole point of the shared set — a column
   * that is *re-declared* here is a column free to drift, and four screens
   * drifting apart is what this component was extracted to stop. A screen that
   * re-cuts the set also needs its own `storageKey`.
   *
   * The paperclip still attaches, as long as the set keeps a column keyed
   * `"title"` — see `withClipBadge`.
   */
  columns?: DataGridColumn<Row>[];
  /**
   * The grid's persisted layout key. The Entries tabs and Search Results all
   * share one, so a width or a hidden column set on one holds on all of them. A
   * screen with different columns needs its own, or hiding a column on one would
   * silently change the other.
   */
  storageKey: string;
  exportFileName: string;
  emptyMessage: string;
  /** Banding for the zebra stripe — the Duplicates card bands by group. */
  getRowGroupKey?: (row: Row) => string | number;
  stripeClassName?: string;
  /** What the Merge action's entry form needs. */
  formOptions: JournalEntryFormOptions;
  /** Admin-only "Show SQL". Both or neither — `DataGrid` draws the button on `sql`. */
  sql?: string;
  onRunSql?: (sql: string) => void | Promise<void>;
  /** Extra buttons on the selection bar, after Delete. */
  extraSelectionActions?: (selectedRows: Row[], clearSelection: () => void) => ReactNode;
}

/** One pending dialog over a ticked selection. */
interface Pending<Row> {
  rows: Row[];
  clearSelection: () => void;
}

export function JournalEntriesGrid<Row extends JournalEntry>({
  rows,
  scope,
  onRowsChanged,
  onError,
  onNotice,
  onBusyChange,
  onRowClick,
  clipCounts,
  leadingColumns,
  columns: columnSet = JOURNAL_ENTRY_COLUMNS as DataGridColumn<Row>[],
  storageKey,
  exportFileName,
  emptyMessage,
  getRowGroupKey,
  stripeClassName,
  formOptions,
  sql,
  onRunSql,
  extraSelectionActions,
}: JournalEntriesGridProps<Row>) {
  const router = useRouter();
  // Which entry's clips the paperclip opened, or undefined when none. Migration
  // 0155 — the dialog lists them and opens the one the reader picks.
  const [clipsForEntry, setClipsForEntry] = useState<number | undefined>(undefined);
  // The bulk actions on the ticked rows. `clearSelection` is handed in by
  // `DataGrid` — selection lives there, and this is the only way to drop it
  // after the rows it referred to have changed.
  const [bulkEdit, setBulkEdit] = useState<Pending<Row> | undefined>();
  // The overwrite dialog is its own state rather than a flag on `bulkEdit`: the
  // two are different dialogs over the same action, and a shared slot would let
  // a stale `mode` decide which one a reader is looking at.
  const [bulkOverwrite, setBulkOverwrite] = useState<Pending<Row> | undefined>();
  const [confirmDelete, setConfirmDelete] = useState<Pending<Row> | undefined>();
  // `isLocked` is the target state, not a toggle — Lock and Unlock are two
  // buttons so a mixed selection has a defined result. See bulk-lock.ts.
  const [confirmLock, setConfirmLock] = useState<(Pending<Row> & { isLocked: boolean }) | undefined>();
  // The password is held only for the duration of the request and never stored
  // — `EncryptionPrompt` clears its own fields on submit, and nothing here
  // keeps a copy. See bulk-encrypt.ts on why there is no recovery path.
  const [confirmEncrypt, setConfirmEncrypt] = useState<Pending<Row> | undefined>();
  const [encryptError, setEncryptError] = useState<string | undefined>(undefined);
  const [isBusy, setIsBusy] = useState(false);

  function setBusy(next: boolean) {
    setIsBusy(next);
    onBusyChange?.(next);
  }

  // The Merge bulk action. See journal-merge-flow.tsx. It clears its own
  // selection, so the no-op here is the flow's own contract, not an oversight.
  const merging = useJournalMerge({
    scope,
    applyRows: (nextEntries, message) => adopt(nextEntries, message, () => undefined),
    setError: onError,
    setNotice: onNotice,
    setBusy,
  });

  /**
   * Swaps in the server's rows, says what happened, and closes every dialog.
   *
   * The cast is the one seam where the row type is asserted rather than proved.
   * The actions are typed `JournalEntry[]` because that is what every arm of
   * `BulkRefreshScope` has in common; which *subtype* comes back is decided by
   * the `scope` the caller passed, and the caller is the same component that
   * declared `Row`. Pass `{ tab: "duplicates" }` and you get `DuplicateRow`s;
   * pass any other arm and you get plain entries. Nothing else in this file
   * reads the extra fields, so a mismatch would surface in the caller's columns
   * rather than here — keep the two together.
   */
  function adopt(nextEntries: JournalEntry[], message: string, clearSelection: () => void) {
    onRowsChanged(nextEntries as Row[], message);
    onError(undefined);
    clearSelection();
    setBulkEdit(undefined);
    setBulkOverwrite(undefined);
    setConfirmDelete(undefined);
    setConfirmLock(undefined);
    setConfirmEncrypt(undefined);
    // The module's other screens (Today in History, the Calendar, the entry
    // counts in the chrome) read the same rows, so they need re-rendering too —
    // the action revalidated the path.
    router.refresh();
  }

  async function runBulkDelete(selectedRows: Row[], clearSelection: () => void) {
    const failed = "Failed to delete the selected entries.";
    setBusy(true);
    onError(undefined);
    try {
      const result = await deleteJournalEntriesAction(
        selectedRows.map((entry) => entry.id),
        scope(),
      );
      if (!result.ok || !result.entries) {
        onError(result.error ?? failed);
        return;
      }
      adopt(result.entries, result.message ?? "Entries deleted.", clearSelection);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : failed);
    } finally {
      setBusy(false);
    }
  }

  async function runBulkLock(selectedRows: Row[], isLocked: boolean, clearSelection: () => void) {
    const failed = `Failed to ${isLocked ? "lock" : "unlock"} the selected entries.`;
    setBusy(true);
    onError(undefined);
    try {
      const result = await bulkLockJournalEntriesAction(
        selectedRows.map((entry) => entry.id),
        isLocked,
        scope(),
      );
      if (!result.ok || !result.entries) {
        onError(result.error ?? failed);
        return;
      }
      adopt(result.entries, result.message ?? "Entries updated.", clearSelection);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : failed);
    } finally {
      setBusy(false);
    }
  }

  async function runBulkEncrypt(
    selectedRows: Row[],
    password: string,
    hint: string,
    clearSelection: () => void,
  ) {
    const failed = "Failed to encrypt the selected entries.";
    setBusy(true);
    setEncryptError(undefined);
    onError(undefined);
    try {
      const result = await bulkEncryptJournalEntriesAction(
        selectedRows.map((entry) => entry.id),
        password,
        hint,
        scope(),
      );
      if (!result.ok || !result.entries) {
        // Shown inside the prompt rather than as the page-level error: the
        // dialog stays open so the password can be retyped, and a message
        // behind it would be invisible.
        setEncryptError(result.error ?? failed);
        return;
      }
      adopt(result.entries, result.message ?? "Entries encrypted.", clearSelection);
    } catch (caught) {
      setEncryptError(caught instanceof Error ? caught.message : failed);
    } finally {
      setBusy(false);
    }
  }

  // Both or neither: DataGrid only draws the button when `onRunSql` is present,
  // and a statement the server declined to send means there is nothing to show.
  const sqlProps = sql && onRunSql ? { sql, onRunSql } : {};

  // Leading columns first, then the screen's set — which is the shared
  // JOURNAL_ENTRY_COLUMNS unless the caller passed its own. One array, so a
  // screen cannot interleave its own column into the middle of that set.
  const gridColumns = withClipBadge<Row>(
    [...(leadingColumns ?? []), ...columnSet],
    clipCounts,
    setClipsForEntry,
  );

  return (
    <>
      <DataGrid
        columns={gridColumns}
        rows={rows}
        getRowKey={(entry) => entry.id}
        emptyMessage={emptyMessage}
        enableExport
        exportFileName={exportFileName}
        storageKey={storageKey}
        getRowGroupKey={getRowGroupKey}
        stripeClassName={stripeClassName}
        // The eye column is off everywhere: the row click already opens the entry.
        enableRecordView={false}
        onRowClick={onRowClick}
        enableSelection
        renderSelectionActions={(selectedRows, clearSelection) => (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={isBusy}
              onClick={() => setBulkEdit({ rows: selectedRows, clearSelection })}
            >
              Bulk edit
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={isBusy}
              onClick={() => setBulkOverwrite({ rows: selectedRows, clearSelection })}
            >
              Bulk overwrite
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={isBusy}
              onClick={() => setConfirmLock({ rows: selectedRows, clearSelection, isLocked: true })}
            >
              Lock
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={isBusy}
              onClick={() => setConfirmLock({ rows: selectedRows, clearSelection, isLocked: false })}
            >
              Unlock
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={isBusy}
              onClick={() => {
                setEncryptError(undefined);
                setConfirmEncrypt({ rows: selectedRows, clearSelection });
              }}
            >
              Encrypt
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={isBusy || selectedRows.length < 2}
              title={selectedRows.length < 2 ? "Tick two or more entries to merge them" : undefined}
              onClick={() => void merging.start(selectedRows, clearSelection)}
            >
              Merge
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={isBusy}
              onClick={() => setConfirmDelete({ rows: selectedRows, clearSelection })}
            >
              Delete
            </Button>
            {extraSelectionActions?.(selectedRows, clearSelection)}
          </>
        )}
        {...sqlProps}
      />

      <JournalMergeDialogs
        merge={merging.merge}
        cleanup={merging.cleanup}
        formOptions={formOptions}
        isBusy={isBusy}
        onMergeClose={merging.close}
        onSavingChange={setBusy}
        onMergeSaved={(saved) => void merging.handleSaved(saved)}
        onCleanupKeep={merging.keep}
        onCleanupDelete={(sourceIds) => void merging.runCleanup(sourceIds)}
      />

      {bulkEdit && (
        <JournalEntriesBulkEdit
          selected={bulkEdit.rows}
          categoryOptions={formOptions.categoryOptions}
          tagOptions={formOptions.tagOptions}
          locationCategoryOptions={formOptions.locationCategoryOptions}
          locationTagOptions={formOptions.locationTagOptions}
          scope={scope()}
          onCancel={() => setBulkEdit(undefined)}
          onApplied={(nextEntries, message) =>
            adopt(nextEntries, message, bulkEdit.clearSelection)
          }
        />
      )}

      {bulkOverwrite && (
        <JournalEntriesBulkOverwrite
          selected={bulkOverwrite.rows}
          categoryOptions={formOptions.categoryOptions}
          tagOptions={formOptions.tagOptions}
          locationCategoryOptions={formOptions.locationCategoryOptions}
          locationTagOptions={formOptions.locationTagOptions}
          scope={scope()}
          onCancel={() => setBulkOverwrite(undefined)}
          onApplied={(nextEntries, message) =>
            adopt(nextEntries, message, bulkOverwrite.clearSelection)
          }
        />
      )}

      {confirmDelete && (
        <BulkConfirm
          title="Delete these entries?"
          description="They move to the recycle bin under Data Management, and can be restored from there."
          count={confirmDelete.rows.length}
          noun={{ one: "entry", many: "entries" }}
          caveat={
            confirmDelete.rows.some((entry) => entry.isLocked) ? (
              <>
                Some of these are <span className="text-ink">locked</span>. They move to the bin
                too, still locked — restoring one brings it back locked.
              </>
            ) : undefined
          }
          confirmLabel="Delete"
          isBusy={isBusy}
          onCancel={() => setConfirmDelete(undefined)}
          onConfirm={() => void runBulkDelete(confirmDelete.rows, confirmDelete.clearSelection)}
        />
      )}

      {confirmLock && (
        <BulkConfirm
          title={confirmLock.isLocked ? "Lock these entries?" : "Unlock these entries?"}
          description={
            confirmLock.isLocked
              ? "A locked entry can't be edited or deleted on its own screen until it is unlocked."
              : "Unlocking makes these entries editable again."
          }
          count={confirmLock.rows.length}
          noun={{ one: "entry", many: "entries" }}
          caveat={(() => {
            // Only the rows that won't change are worth a caveat — saying "3 of 40
            // are already locked" is what stops the result line reading as a
            // partial failure afterwards.
            const unchanged = confirmLock.rows.filter(
              (entry) => entry.isLocked === confirmLock.isLocked,
            ).length;
            if (unchanged === 0) return undefined;
            return (
              <>
                {unchanged === 1 ? "1 is" : `${unchanged} are`} already{" "}
                {confirmLock.isLocked ? "locked" : "unlocked"} and will be left alone.
              </>
            );
          })()}
          confirmLabel={confirmLock.isLocked ? "Lock" : "Unlock"}
          tone="primary"
          isBusy={isBusy}
          onCancel={() => setConfirmLock(undefined)}
          onConfirm={() =>
            void runBulkLock(confirmLock.rows, confirmLock.isLocked, confirmLock.clearSelection)
          }
        />
      )}

      {confirmEncrypt && (
        <EncryptionPrompt
          mode="encrypt"
          asModal
          count={confirmEncrypt.rows.length}
          heading={
            confirmEncrypt.rows.length === 1
              ? "Encrypt this entry"
              : `Encrypt ${confirmEncrypt.rows.length} entries`
          }
          actionLabel="Encrypt"
          error={encryptError}
          isBusy={isBusy}
          onCancel={() => {
            setConfirmEncrypt(undefined);
            setEncryptError(undefined);
          }}
          onSubmit={(password, hint) =>
            void runBulkEncrypt(
              confirmEncrypt.rows,
              password,
              hint,
              confirmEncrypt.clearSelection,
            )
          }
        />
      )}

      {/* A sibling of the dialogs above, not a child — it is z-[60] to Modal's
          z-50 so the dialog dims along with the page. Encrypting a long
          selection is the slowest write on this screen, and it is the one that
          must not be interrupted. */}
      <BusyOverlay
        isBusy={isBusy && confirmEncrypt !== undefined}
        message="Encrypting…"
        detail="Don't close this window."
      />

      {/* Migration 0155. Raised by the paperclip on a Title cell: lists that
          entry's clips, or opens the clip directly when there is only one. */}
      {clipsForEntry !== undefined && (
        <EntryClipsDialog entryId={clipsForEntry} onClose={() => setClipsForEntry(undefined)} />
      )}
    </>
  );
}
