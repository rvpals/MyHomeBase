"use client";

// "In history on November 24" — every entry filed on one month and day, in any
// year, raised from a Calendar cell's **Today in history** button.
//
// A dialog rather than a screen, because it is an aside from the month you are
// reading: answering it and closing it must put you back on the same grid with
// the same day open. For the same reason a row click opens the entry *here* in
// the registered viewer instead of navigating — a `router.push` would unmount
// the calendar and this dialog with it, and the reader would lose the list.
// Duplicate entries makes the same call for the same reason.
//
// The list is fetched on mount rather than passed in. The calendar server-reads
// one period (a month is 42 days), and this question reaches outside it by
// definition; pre-reading all 366 answers so a prop could be handed down would
// ship the whole journal to the client in case someone pressed a square.
//
// Route-local and not in `src/components/`: it imports server actions, which the
// components registry forbids — the same shape and the same reason as
// journal-entries-grid.tsx, which it renders.

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/modal";
import { JournalViewer } from "@/components/journal-viewer";
import { formatMonthDayHeading, monthDayOf, type JournalEntry } from "@/lib/journal";
import type { BulkRefreshScope } from "./journal-bulk-actions";
import { getJournalEntryAction } from "./journal-correct-actions";
import { JournalEntriesGrid, type JournalEntryFormOptions } from "./journal-entries-grid";
import { onThisDayEntriesAction } from "./journal-on-this-day-actions";
import { journalEntriesFilterHref } from "./journal-shared";

export interface JournalOnThisDayDialogProps {
  /** The cell that was pressed, "YYYY-MM-DD". Only its month and day are used. */
  date: string;
  /** Category/tag name → icon URL, for the viewer. */
  categoryIcons: Record<string, string>;
  tagIcons: Record<string, string>;
  /** What the grid's Bulk edit, Bulk overwrite and Merge dialogs need. */
  formOptions: JournalEntryFormOptions;
  onClose: () => void;
}

export function JournalOnThisDayDialog({
  date,
  categoryIcons,
  tagIcons,
  formOptions,
  onClose,
}: JournalOnThisDayDialogProps) {
  const [rows, setRows] = useState<JournalEntry[]>([]);
  const [clipCounts, setClipCounts] = useState<Record<number, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState("");
  /**
   * The entry the reader opened, fetched whole. The rows arrive with `content`
   * blanked (src/lib/journal/on-this-day.ts), so the body has to be read before
   * the viewer can show it.
   */
  const [openEntry, setOpenEntry] = useState<JournalEntry | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await onThisDayEntriesAction(date);
      if (cancelled) return;
      if (!result.ok || !result.entries) {
        setError(result.error ?? "Failed to read that day's entries in history.");
      } else {
        setRows(result.entries);
        setClipCounts(result.clipCounts ?? {});
      }
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  /**
   * Keyed by the **month-day**, not the date that was clicked. The dialog's
   * question has no year in it, so a scope naming one would hand back a single
   * year's entries after the first write and empty the list.
   */
  const scope = useCallback((): BulkRefreshScope => ({ tab: "onThisDay", monthDay: monthDayOf(date) }), [date]);

  async function openLiveEntry(entryId: number) {
    setIsBusy(true);
    setError(undefined);
    try {
      const result = await getJournalEntryAction(entryId);
      if (!result.ok || !result.entry) {
        setError(result.error ?? "Failed to open that entry.");
        return;
      }
      setOpenEntry(result.entry);
    } finally {
      setIsBusy(false);
    }
  }

  const heading = formatMonthDayHeading(date);

  return (
    <>
      <Modal
        title={`In history on ${heading}`}
        description={
          isLoading
            ? "Reading every year…"
            : rows.length === 1
              ? `1 entry filed on ${heading}, across every year.`
              : `${rows.length} entries filed on ${heading}, across every year.`
        }
        size="lg"
        isBusy={isBusy}
        onClose={onClose}
      >
        {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
        {notice && !error && <p className="mb-2 text-sm text-muted">{notice}</p>}

        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted">Loading…</p>
        ) : (
          <JournalEntriesGrid
            rows={rows}
            scope={scope}
            // The calendar behind this dialog goes stale on any write — a deleted
            // entry would still be sitting in its cell — but there is nothing to do
            // about it here: the grid revalidates the path and calls
            // `router.refresh()` itself, naming the Calendar as one of the screens
            // it is refreshing for. A second refresh from here would be the same
            // round trip twice.
            onRowsChanged={(nextRows, message) => {
              setRows(nextRows);
              setNotice(message);
            }}
            onError={setError}
            onNotice={setNotice}
            onBusyChange={setIsBusy}
            // The viewer rather than the entry screen: navigating away would take
            // the calendar and this dialog with it.
            onRowClick={(row) => void openLiveEntry(row.id)}
            clipCounts={clipCounts}
            // The shared column set exactly, so it shares the Entries list's key:
            // a column hidden there is hidden here, which is the right answer for
            // two grids showing the same five columns.
            storageKey="myhomebase:journal-entries-grid"
            exportFileName={`journal-on-this-day-${monthDayOf(date)}`}
            emptyMessage={`Nothing is filed on ${heading} in any year.`}
            formOptions={formOptions}
          />
        )}
      </Modal>

      {openEntry && (
        // A second panel over the first. Only the topmost answers Escape — see
        // MODAL_STACK in src/components/modal.tsx — so closing this one returns
        // the reader to the list rather than dismissing both.
        <Modal
          title={openEntry.title.trim() === "" ? "(untitled)" : openEntry.title}
          description={openEntry.date}
          size="lg"
          onClose={() => setOpenEntry(undefined)}
        >
          {/* Read-only: this is a list you skim, and the entry's own screen is
              where it is edited. The taxonomy links still work — they leave the
              calendar, which is a deliberate navigation rather than a lost one. */}
          <JournalViewer
            entry={openEntry}
            categoryIcons={categoryIcons}
            tagIcons={tagIcons}
            categoryHref={(name) => journalEntriesFilterHref("category", name)}
            tagHref={(name) => journalEntriesFilterHref("tag", name)}
          />
        </Modal>
      )}
    </>
  );
}
