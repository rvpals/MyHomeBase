"use client";

// Clips → Recycled Clips: the bin (migration 0161).
//
// Deleting a clip on the Home screen moves it here. This screen is the only place
// a clip is actually destroyed.
//
// A `DataGrid` rather than the board's cards, and that is a deliberate difference
// in kind. `ClipsCard` is built around the things you do to a *live* clip — pin,
// recolour, edit, tick a checklist item — and none of them mean anything to a
// binned one, which is read-only until it is restored. Bending the card through
// five more optional props to render a row that can do none of what it is for
// would be worse than a grid, and the grid brings selection, bulk actions, an
// empty state and a compact layout that already works on a phone.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import type { RecycledClip } from "@/lib/clips";
import {
  deleteRecycledClipsForeverAction,
  emptyClipsRecycleBinAction,
  restoreRecycledClipsAction,
} from "./clips-actions";

/**
 * A SQLite `datetime('now')` stamp, read as UTC and shown in the reader's zone.
 *
 * The same helper, for the same reason, as the one in `admin/messages/view.tsx`:
 * the stored form is `YYYY-MM-DD HH:MM:SS` with no zone, and handing that to
 * `new Date()` directly gives "Invalid Date" in Safari. Kept local rather than
 * shared — it is a component-scoped detail of how one screen prints a column.
 */
function formatWhen(value: string): string {
  const parsed = new Date(`${value.replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface ClipsRecycledViewProps {
  /** The whole bin, newest deleted first. Read by the server component. */
  clips: RecycledClip[];
}

export function ClipsRecycledView({ clips }: ClipsRecycledViewProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /**
   * Runs one bulk action and refreshes.
   *
   * `router.refresh()` rather than a local splice: restoring moves a clip back
   * into the Home screen's list, which is the server's answer to give — and the
   * action revalidates both paths for the same reason.
   */
  async function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    clearSelection?: () => void,
  ) {
    setBusy(true);
    setError("");
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "That did not work.");
      return;
    }
    clearSelection?.();
    router.refresh();
  }

  function handleRestore(rows: RecycledClip[], clearSelection: () => void) {
    // No confirmation: restoring is the safe direction, and a clip put back by
    // mistake can simply be deleted again.
    void run(() => restoreRecycledClipsAction(rows.map((row) => row.recycledId)), clearSelection);
  }

  function handlePurge(rows: RecycledClip[], clearSelection: () => void) {
    const count = rows.length;
    if (
      !confirm(
        `Permanently delete ${count} clip${count === 1 ? "" : "s"}? This cannot be undone.`,
      )
    ) {
      return;
    }
    void run(
      () => deleteRecycledClipsForeverAction(rows.map((row) => row.recycledId)),
      clearSelection,
    );
  }

  function handleEmpty() {
    const count = clips.length;
    if (count === 0) return;
    if (
      !confirm(
        `Permanently delete all ${count} clip${count === 1 ? "" : "s"} in the bin? This cannot be undone.`,
      )
    ) {
      return;
    }
    void run(() => emptyClipsRecycleBinAction());
  }

  const columns: DataGridColumn<RecycledClip>[] = [
    {
      key: "title",
      header: "Clip",
      // `title` already reads "(encrypted)" for a sealed clip — `displayTitle` is
      // applied in the repository, so the bin cannot accidentally print ciphertext.
      render: (row) => (
        <div>
          <div className="font-medium text-ink">{row.title || "Untitled"}</div>
          {row.excerpt !== "" && (
            <div className="mt-0.5 line-clamp-2 text-xs text-muted">{row.excerpt}</div>
          )}
        </div>
      ),
      value: (row) => row.title,
    },
    {
      key: "filed",
      header: "Filed under",
      render: (row) => {
        const names = [...row.categories, ...row.tags];
        if (names.length === 0) return <span className="text-muted">—</span>;
        return (
          <div className="flex flex-wrap gap-1 text-xs text-muted">
            {names.map((name) => (
              <span key={name} className="rounded border border-line px-1.5 py-0.5">
                {name}
              </span>
            ))}
          </div>
        );
      },
      value: (row) => [...row.categories, ...row.tags].join(", "),
    },
    {
      key: "contents",
      header: "Holds",
      // What would come back with it. The count is the honest thing to show here:
      // the bin never serves a binned image, so there is nothing to draw.
      render: (row) => {
        const parts: string[] = [];
        if (row.items.length > 0) parts.push(`${row.items.length} item${row.items.length === 1 ? "" : "s"}`);
        if (row.imageCount > 0) parts.push(`${row.imageCount} image${row.imageCount === 1 ? "" : "s"}`);
        if (row.linkCount > 0) parts.push(`${row.linkCount} link${row.linkCount === 1 ? "" : "s"}`);
        return parts.length > 0 ? parts.join(", ") : <span className="text-muted">—</span>;
      },
      value: (row) => row.items.length + row.imageCount + row.linkCount,
    },
    {
      key: "deletedAt",
      header: "Deleted",
      render: (row) => formatWhen(row.deletedAt),
      value: (row) => row.deletedAt,
    },
    {
      key: "actions",
      header: "Actions",
      // Out of the record modal: a row's buttons are not part of a read-out of
      // the record, per `components.md`.
      excludeFromRecordView: true,
      sortable: false,
      render: (row) => (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => handleRestore([row], () => {})}
          >
            Restore
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => handlePurge([row], () => {})}
          >
            Delete forever
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {clips.length === 0
            ? "The bin is empty."
            : `${clips.length} clip${clips.length === 1 ? "" : "s"} waiting. Nothing here is deleted until you say so.`}
        </p>
        {clips.length > 0 && (
          <Button variant="danger" disabled={busy} onClick={handleEmpty}>
            Empty the bin
          </Button>
        )}
      </div>

      {error !== "" && (
        <p className="mb-3 rounded-md border border-line bg-paper-raised px-3 py-2 text-sm text-ink">
          {error}
        </p>
      )}

      <DataGrid
        columns={columns}
        rows={clips}
        // The bin's own key, never the clip id and never the row's position: the
        // same clip can sit in the bin twice, and a bulk action keyed on anything
        // else would act on the wrong copy.
        getRowKey={(row) => row.recycledId}
        enableSelection
        renderSelectionActions={(selectedRows, clearSelection) => (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => handleRestore(selectedRows, clearSelection)}
            >
              Restore
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() => handlePurge(selectedRows, clearSelection)}
            >
              Delete forever
            </Button>
          </>
        )}
        emptyMessage="Nothing in the bin. Deleted clips land here."
        storageKey="myhomebase:clips-recycled"
        exportFileName="recycled-clips"
      />
    </div>
  );
}
