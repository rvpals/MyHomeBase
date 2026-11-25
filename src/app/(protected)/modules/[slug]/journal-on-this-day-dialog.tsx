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

import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/modal";
import { JournalViewer } from "@/components/journal-viewer";
import type { DataGridColumn } from "@/components/data-grid";
import {
  formatMonthDayHeading,
  ON_THIS_DAY_EXCERPT_WORDS,
  monthDayOf,
  type JournalEntry,
  type OnThisDayRow,
} from "@/lib/journal";
import type { BulkRefreshScope } from "./journal-bulk-actions";
import { getJournalEntryAction } from "./journal-correct-actions";
import {
  JOURNAL_ENTRY_COLUMNS,
  JournalEntriesGrid,
  type JournalEntryFormOptions,
} from "./journal-entries-grid";
import { onThisDayEntriesAction } from "./journal-on-this-day-actions";
import { journalEntriesFilterHref } from "./journal-shared";

/** "This year" / "1 year ago" / "7 years ago" — the first column's cell. */
function yearsAgoLabel(yearsAgo: number): string {
  if (yearsAgo === 0) return "This year";
  return yearsAgo === 1 ? "1 year ago" : `${yearsAgo} years ago`;
}

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
  const [rows, setRows] = useState<OnThisDayRow[]>([]);
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

  /**
   * This screen's columns: **Years ago**, then Date / Time / Title taken verbatim
   * from the shared set, then the body excerpt.
   *
   * Built by filtering `JOURNAL_ENTRY_COLUMNS` rather than retyping those three,
   * so they stay byte-identical to every other journal grid — a re-declared
   * column is a column free to drift, which is the thing `JournalEntriesGrid`
   * exists to prevent.
   *
   * Categories and Tags are dropped. On a list that spans one date across twenty
   * years they are the same handful of values repeating down the page, where the
   * body text is what actually distinguishes one row from the next.
   *
   * `yearsAgo` is derived here rather than carried on the row: it only means
   * anything relative to the cell that was pressed, and the server has no idea
   * which year that was — the refresh scope deliberately carries only a
   * month-day. Memoized on `date` because the reference year is the only input.
   */
  const columns = useMemo<DataGridColumn<OnThisDayRow>[]>(() => {
    const referenceYear = Number(date.slice(0, 4));
    const yearsAgoOf = (row: OnThisDayRow) => referenceYear - Number(row.date.slice(0, 4));

    const yearsAgoColumn: DataGridColumn<OnThisDayRow> = {
      key: "yearsAgo",
      header: "Years ago",
      // The number, so the column sorts chronologically rather than
      // alphabetically — "10 years ago" must not sort between "1" and "2".
      value: yearsAgoOf,
      render: (row) => (
        <span className="whitespace-nowrap">{yearsAgoLabel(yearsAgoOf(row))}</span>
      ),
    };

    const contentColumn: DataGridColumn<OnThisDayRow> = {
      key: "excerpt",
      header: "Content",
      // The excerpt, not `content` — the body is blanked on these rows, and
      // sorting or exporting an empty string would be a column of nothing.
      value: (row) => row.excerpt,
      hint: `The first ${ON_THIS_DAY_EXCERPT_WORDS} words of the entry. Open the row for the whole thing.`,
      // Wraps to three lines and clips, rather than one truncated line: the
      // excerpt is the reason this column exists, and one line of a hundred
      // words shows almost none of it. `break-words` so an unbroken paste can't
      // push the column wider than its share.
      className: "align-top",
      render: (row) => (
        <span className="line-clamp-3 break-words text-xs leading-snug text-muted">
          {row.excerpt}
        </span>
      ),
    };

    return [
      yearsAgoColumn,
      ...(JOURNAL_ENTRY_COLUMNS as DataGridColumn<OnThisDayRow>[]).filter(
        (column) => column.key !== "categories" && column.key !== "tags",
      ),
      contentColumn,
    ];
  }, [date]);

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
        // Wider than `lg`'s own 4xl: this grid carries six columns, one of them a
        // three-line excerpt. `className` is merged last onto the panel, which is
        // the sanctioned way to take a different shape without a new size — see
        // the `Modal` entry in components.md. Capped against the viewport, so a
        // laptop still gets a dialog rather than a full-bleed sheet. Below 1024px
        // it is already full-width and `DataGrid` is in its card layout, so the
        // cap never bites there.
        className="max-w-[min(90rem,95vw)]"
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
            columns={columns}
            // Its own key, not the Entries list's: this grid re-cuts the shared
            // set, so sharing one would let a hidden-column choice made here
            // change a screen that has different columns.
            storageKey="myhomebase:journal-on-this-day-grid"
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
