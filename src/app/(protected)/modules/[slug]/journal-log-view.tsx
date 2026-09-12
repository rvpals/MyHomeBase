"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { Comments } from "@/components/comments";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { JournalViewer } from "@/components/journal-viewer";
import { Modal } from "@/components/modal";
import type { JournalEntry } from "@/lib/journal";
import { getJournalEntryAction } from "./journal-correct-actions";
import { journalEntriesFilterHref } from "./journal-shared";
import { deleteLogEntriesAction } from "./journal-log-actions";

export interface JournalLogViewProps {
  entries: JournalEntry[];
  categoryIcons: Record<string, string>;
  tagIcons: Record<string, string>;
}

/**
 * The Log section: every entry carrying the Log category — the activities you
 * logged rather than wrote about, including everything Calendar Import created.
 *
 * One `DataGrid`, which is where the search, per-column filters, sorting, paging,
 * CSV export, selection and below-1024px card layout all come from. The section
 * adds only two things of its own: opening a row in `JournalViewer`, and a bulk
 * delete that moves the ticked rows to the recycle bin.
 *
 * The list is read on the server by `listLogEntries` and handed down, then
 * replaced wholesale by each action's response — a delete changes which rows
 * exist, and patching the local copy would leave it disagreeing with the server
 * about what is still there.
 *
 * **Narrow behaviour:** `DataGrid`'s own compact layout takes over below 1024px,
 * which keeps search and selection working; the viewer is a `Modal`, which is
 * already responsive.
 */
export function JournalLogView({ entries: initialEntries, categoryIcons, tagIcons }: JournalLogViewProps) {
  const router = useRouter();

  const [entries, setEntries] = useState(initialEntries);
  const [viewing, setViewing] = useState<JournalEntry | undefined>();
  const [confirm, setConfirm] = useState<{ ids: number[]; clearSelection: () => void } | undefined>();
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  /**
   * Opens a row in the viewer, reading the entry fresh rather than showing the
   * row's copy: the grid's rows came from the page's render, and the entry may
   * have been edited since.
   */
  async function openEntry(id: number) {
    setError("");
    try {
      const result = await getJournalEntryAction(id);
      if (!result.ok || !result.entry) {
        setError(result.error ?? "Failed to open that entry.");
        return;
      }
      setViewing(result.entry);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to open that entry.");
    }
  }

  async function runDelete(ids: number[], clearSelection: () => void) {
    setIsBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await deleteLogEntriesAction(ids);
      if (!result.ok || !result.entries) {
        setError(result.error ?? "Failed to delete the selected log entries.");
        return;
      }
      setEntries(result.entries);
      const moved = result.movedCount ?? 0;
      setNotice(
        `Moved ${moved} ${moved === 1 ? "entry" : "entries"} to the recycle bin.` +
          ((result.skippedCount ?? 0) > 0 ? ` ${result.skippedCount} were already gone.` : ""),
      );
      setConfirm(undefined);
      clearSelection();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to delete the selected log entries.");
    } finally {
      setIsBusy(false);
    }
  }

  const columns: DataGridColumn<JournalEntry>[] = [
    {
      key: "when",
      header: "When",
      render: (entry) => (
        <span className="whitespace-nowrap">
          {entry.date}
          {entry.time !== "" && <span className="text-muted"> {entry.time}</span>}
        </span>
      ),
      value: (entry) => `${entry.date} ${entry.time}`.trim(),
    },
    {
      key: "title",
      header: "Title",
      render: (entry) =>
        entry.title === "" ? <span className="text-muted">(untitled)</span> : entry.title,
      value: (entry) => entry.title,
    },
    {
      key: "placeName",
      header: "Place",
      render: (entry) => entry.placeName,
      value: (entry) => entry.placeName,
    },
    {
      key: "tags",
      header: "Tags",
      render: (entry) => entry.tags.join(", "),
      value: (entry) => entry.tags.join(", "),
    },
    {
      key: "categories",
      header: "Categories",
      render: (entry) => entry.categories.join(", "),
      value: (entry) => entry.categories.join(", "),
    },
    {
      key: "source",
      header: "Source",
      // `source` is "" for anything typed in by hand, which reads better as a
      // word than as an empty cell in a list where most rows say "ics".
      render: (entry) => (entry.source === "" ? <span className="text-muted">by hand</span> : entry.source),
      value: (entry) => (entry.source === "" ? "by hand" : entry.source),
    },
    {
      key: "note",
      header: "Note",
      render: (entry) => (
        <span className="text-muted">
          {entry.content.length > 60 ? `${entry.content.slice(0, 60)}…` : entry.content}
        </span>
      ),
      value: (entry) => entry.content,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-muted">{notice}</p>}

      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted">
          Everything carrying the <span className="text-ink">Log</span> category — logged
          activities rather than written entries. These are kept out of the home screen&apos;s
          Today in History card; they still appear in Entries, Calendar and search.
        </p>
        <Comments
          title="About"
          label="About"
          content={
            "A log entry is a short record of something that happened — a practice, a lesson, " +
            "an appointment — rather than something you sat down to write. Anything the " +
            "Calendar Import creates lands here, and you can add one by hand by giving a new " +
            "entry the Log category.\n\n" +
            "Click a row to read it. Deleting moves entries to the recycle bin under Data " +
            "Management, so a mis-ticked row is recoverable."
          }
        />
      </div>

      <DataGrid
        columns={columns}
        rows={entries}
        getRowKey={(entry) => entry.id}
        emptyMessage="No log entries yet. Import a calendar, or give an entry the Log category."
        exportFileName="journal-log"
        storageKey="journal-log-grid"
        enableSelection
        onRowClick={(entry) => void openEntry(entry.id)}
        // The viewer modal is the record view here — it renders an entry
        // properly, which the generic record read-out can't.
        enableRecordView={false}
        renderSelectionActions={(selectedRows, clearSelection) => (
          <Button
            size="sm"
            variant="danger"
            disabled={isBusy}
            onClick={() =>
              setConfirm({ ids: selectedRows.map((entry) => entry.id), clearSelection })
            }
          >
            Delete checked
          </Button>
        )}
      />

      {viewing && (
        <Modal title={viewing.title === "" ? "Log entry" : viewing.title} onClose={() => setViewing(undefined)}>
          <JournalViewer
            entry={viewing}
            categoryIcons={categoryIcons}
            tagIcons={tagIcons}
            categoryHref={(name) => journalEntriesFilterHref("category", name)}
            tagHref={(name) => journalEntriesFilterHref("tag", name)}
          />
        </Modal>
      )}

      {confirm && (
        <Modal
          title="Delete these log entries?"
          description="They move to the recycle bin under Data Management, and can be restored from there."
          onClose={() => setConfirm(undefined)}
          isBusy={isBusy}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirm(undefined)} disabled={isBusy}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={isBusy}
                onClick={() => void runDelete(confirm.ids, confirm.clearSelection)}
              >
                {isBusy ? "Working…" : "Delete"}
              </Button>
            </>
          }
        >
          <p className="text-sm text-ink">
            {confirm.ids.length} {confirm.ids.length === 1 ? "entry" : "entries"} selected.
          </p>
        </Modal>
      )}
    </div>
  );
}
