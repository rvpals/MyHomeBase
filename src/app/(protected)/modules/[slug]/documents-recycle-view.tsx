"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BulkConfirm } from "@/components/bulk-confirm";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { TaxonomyChipRow } from "@/components/taxonomy-icon";
// From the leaf module, NOT the barrel: this is a client component, and
// `@/lib/documents` re-exports the repository and the file store, which pull in
// `better-sqlite3` and `node:fs/promises`. Same reasoning as documents-main-view.tsx.
import { formatBytes } from "@/lib/documents/schema";
import type { RecycledDocument } from "@/lib/documents/types";
import { PAGE_CONTAINER } from "../../page-container";
import {
  emptyDocumentsBinAction,
  purgeRecycledDocumentsAction,
  restoreDocumentsAction,
} from "./documents-actions";

// Documents → Recycled Documents (migration 0163). Restore, purge, or empty the bin.
//
// ## What a purge here does and does not do
//
// It drops the **index** — the title, the filing, and the mapping from each stored
// file to the name it arrived with. It does not touch the files: they have been under
// `_deleted/` on the share since the delete, and nothing in this module ever unlinks a
// user's file. Clearing that folder is a deliberate act on the NAS.
//
// The screen says so plainly rather than warning "this cannot be undone", which would
// be both frightening and false.
//
// ## Narrow screens
//
// `DataGrid` delegates to its compact layout below 1024px, where each row becomes a
// card with the same columns stacked and the selection actions move with it. No
// separate component and no `useIsCompact` branch — the grid already handles it, the
// same way the main list does.

export interface DocumentsRecycleViewProps {
  documents: RecycledDocument[];
}

export function DocumentsRecycleView({ documents }: DocumentsRecycleViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pendingPurge, setPendingPurge] = useState<{
    rows: RecycledDocument[];
    clearSelection: () => void;
  }>();
  const [confirmEmpty, setConfirmEmpty] = useState(false);

  function restore(rows: RecycledDocument[], clearSelection: () => void) {
    setError(undefined);
    startTransition(async () => {
      const result = await restoreDocumentsAction(rows.map((row) => row.recycledId));
      if (!result.ok) {
        setError(result.error ?? "Could not restore those documents.");
        return;
      }
      // The message may name a renumbering — a document whose original id had been
      // taken comes back under a new one. Surfaced, not swallowed.
      setNotice(result.message);
      clearSelection();
      router.refresh();
    });
  }

  function purge(rows: RecycledDocument[], clearSelection: () => void) {
    setError(undefined);
    startTransition(async () => {
      const result = await purgeRecycledDocumentsAction(rows.map((row) => row.recycledId));
      if (!result.ok) {
        setError(result.error ?? "Could not remove those documents.");
        return;
      }
      setPendingPurge(undefined);
      setNotice(result.message);
      clearSelection();
      router.refresh();
    });
  }

  function emptyBin() {
    setError(undefined);
    startTransition(async () => {
      const result = await emptyDocumentsBinAction();
      if (!result.ok) {
        setError(result.error ?? "Could not empty the bin.");
        return;
      }
      setConfirmEmpty(false);
      setNotice(result.message);
      router.refresh();
    });
  }

  const columns: DataGridColumn<RecycledDocument>[] = [
    {
      key: "title",
      header: "Title",
      value: (row) => row.title,
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-ink">{row.title}</span>
          {row.description !== "" && (
            <span className="text-xs text-muted">{row.description}</span>
          )}
        </div>
      ),
    },
    {
      key: "filing",
      header: "Filed under",
      value: (row) => [...row.categories, ...row.tags].join(", "),
      render: (row) =>
        row.categories.length === 0 && row.tags.length === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <TaxonomyChipRow
            items={[...row.categories, ...row.tags].map((name) => ({ name }))}
          />
        ),
    },
    {
      key: "files",
      header: "Files",
      value: (row) => row.attachmentCount,
      render: (row) =>
        row.attachmentCount === 0 ? (
          <span className="text-muted">none</span>
        ) : (
          <span className="text-ink">
            {row.attachmentCount} ({formatBytes(row.totalBytes)})
          </span>
        ),
    },
    {
      key: "deletedAt",
      header: "Deleted",
      value: (row) => row.deletedAt,
      // Date only, matching every other list in the module: the bin is sorted by
      // this column, and a full timestamp is noise next to a title.
      render: (row) => <span className="text-muted">{row.deletedAt.slice(0, 10)}</span>,
    },
  ];

  return (
    <div className={PAGE_CONTAINER}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">
            Deleted documents keep their files. Restoring one puts it back where it was.
          </p>
          {documents.length > 0 && (
            <Button variant="danger" disabled={isPending} onClick={() => setConfirmEmpty(true)}>
              Empty the bin
            </Button>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink">
            {error}
          </p>
        )}

        {notice && (
          <p className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-muted">
            {notice}
          </p>
        )}

        <DataGrid
          columns={columns}
          rows={documents}
          getRowKey={(row) => row.recycledId}
          storageKey="documents-recycle-bin"
          emptyMessage="The bin is empty."
          exportFileName="recycled-documents"
          enableSelection
          renderSelectionActions={(selectedRows, clearSelection) => (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={isPending}
                onClick={() => restore(selectedRows, clearSelection)}
              >
                Restore
              </Button>
              <Button
                variant="danger"
                disabled={isPending}
                onClick={() => setPendingPurge({ rows: selectedRows, clearSelection })}
              >
                Remove from bin
              </Button>
            </div>
          )}
        />
      </div>

      {pendingPurge && (
        <BulkConfirm
          title="Remove these from the bin?"
          count={pendingPurge.rows.length}
          noun={{ one: "document", many: "documents" }}
          caveat="Their files stay on the server under _deleted, but nothing will record which file was which."
          confirmLabel="Remove"
          isBusy={isPending}
          onConfirm={() => purge(pendingPurge.rows, pendingPurge.clearSelection)}
          onCancel={() => setPendingPurge(undefined)}
        />
      )}

      {confirmEmpty && (
        <BulkConfirm
          title="Empty the bin?"
          count={documents.length}
          noun={{ one: "document", many: "documents" }}
          caveat="Their files stay on the server under _deleted, but nothing will record which file was which."
          confirmLabel="Empty the bin"
          isBusy={isPending}
          onConfirm={emptyBin}
          onCancel={() => setConfirmEmpty(false)}
        />
      )}
    </div>
  );
}
