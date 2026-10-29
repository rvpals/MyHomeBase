"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { Modal } from "@/components/modal";
import { TaxonomyChipRow } from "@/components/taxonomy-icon";
// Imported from the leaf modules, NOT from `@/lib/documents`. This is a client
// component, and the module's barrel re-exports the repository and the file store --
// which pull in `better-sqlite3` and `node:fs/promises`, neither of which can be
// bundled for a browser. These two files are pure and safe to ship. Same reason
// `UploadCapControl` imports from `@/lib/sqlite-browser/schema` rather than the barrel.
import { formatBytes } from "@/lib/documents/schema";
import { isInlineRenderable } from "@/lib/documents/attachment-path";
import type {
  DocumentAttachment,
  DocumentSummary,
  DocumentTaxonomyItem,
} from "@/lib/documents/types";
import { PAGE_CONTAINER } from "../../page-container";
import { deleteDocumentAction } from "./documents-actions";
import { documentsEditorHref } from "./documents-sections";

// Documents → Home screen. The list, its filters, and the way in to the editor.
//
// There is no separate "All documents" route: this IS the list. A second screen
// showing the same rows behind a different nav row would be the same screen twice —
// the shape Clips settled on when it absorbed its own `all` section.
//
// Narrow: `DataGrid` delegates to `DataGridCompact` below 1024px, so each document
// becomes a card with the same columns stacked. The filter row wraps via `max-lg:`,
// and the dialog is the shared `Modal`, which is already full-width on a phone.

const INPUT_CLASS =
  "rounded-md border border-line bg-paper px-3 py-1.5 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brass";

/**
 * Builds a name -> icon-url lookup from the taxonomy lists the page already fetched.
 *
 * A document summary carries only the *names* it is filed under — deliberately, since
 * the list is a projection — so the icon has to come from the taxonomy lists, which
 * this screen receives anyway to populate its filter dropdowns. One pass here beats a
 * lookup per chip per row.
 *
 * `?v=` is a cache-buster keyed on `updatedAt`: the route sends `max-age=300`, so
 * without it a replaced icon would keep showing the old picture for five minutes.
 * Keyed lower-case because the taxonomy tables are `COLLATE NOCASE`.
 */
function iconUrls(
  items: DocumentTaxonomyItem[],
  segment: "categories" | "tags",
): Map<string, string> {
  const urls = new Map<string, string>();
  for (const item of items) {
    if (!item.hasIcon) continue;
    urls.set(
      item.name.toLowerCase(),
      `/api/documents/${segment}/${encodeURIComponent(item.name)}/icon?v=${encodeURIComponent(item.updatedAt)}`,
    );
  }
  return urls;
}

export function DocumentsMainView({
  documents,
  attachments,
  categories,
  tags,
  search,
  category,
  tag,
}: {
  documents: DocumentSummary[];
  /** Each document's files, keyed by id. Absent means none — see `listAttachmentsFor`. */
  attachments: Record<number, DocumentAttachment[]>;
  categories: DocumentTaxonomyItem[];
  tags: DocumentTaxonomyItem[];
  search: string;
  category: string;
  tag: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Rebuilt per render rather than memoised: both lists are small (a household's
  // categories, not a catalogue), and a stale map would show a removed icon.
  const categoryIcons = iconUrls(categories, "categories");
  const tagIcons = iconUrls(tags, "tags");

  // The filter boxes are local only while being typed; the URL is the state, so a
  // filtered list survives a refresh and can be bookmarked.
  const [searchText, setSearchText] = useState(search);
  const [pendingDelete, setPendingDelete] = useState<DocumentSummary>();
  // Which document's files are on show. The whole row, so the dialog can title itself.
  const [showingFiles, setShowingFiles] = useState<DocumentSummary>();
  const [alsoDeleteFiles, setAlsoDeleteFiles] = useState(false);
  const [error, setError] = useState<string>();

  function applyFilters(next: { search?: string; category?: string; tag?: string }) {
    const params = new URLSearchParams();
    const value = { search: searchText, category, tag, ...next };
    if (value.search.trim() !== "") params.set("search", value.search.trim());
    if (value.category !== "") params.set("category", value.category);
    if (value.tag !== "") params.set("tag", value.tag);
    const query = params.toString();
    router.push(query === "" ? "/modules/documents" : `/modules/documents?${query}`);
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    const deleteFiles = alsoDeleteFiles;
    setError(undefined);
    startTransition(async () => {
      const result = await deleteDocumentAction(id, deleteFiles);
      if (!result.ok) {
        setError(result.error ?? "Could not delete that document.");
        return;
      }
      setPendingDelete(undefined);
      setAlsoDeleteFiles(false);
      router.refresh();
    });
  }

  const columns: DataGridColumn<DocumentSummary>[] = [
    {
      key: "title",
      header: "Title",
      value: (row) => row.title,
      render: (row) => (
        <div className="flex flex-col">
          <span className="text-ink">{row.title}</span>
          {row.description !== "" && (
            <span className="truncate text-xs text-muted" title={row.description}>
              {row.description}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "categories",
      header: "Categories",
      value: (row) => row.categories.join(", "),
      // `url` is looked up from the taxonomy lists — a chip with no uploaded icon
      // gets `undefined` and draws its fallback, which `TaxonomyChipRow` handles.
      render: (row) => (
        <TaxonomyChipRow
          items={row.categories.map((name) => ({ name, url: categoryIcons.get(name.toLowerCase()) }))}
        />
      ),
    },
    {
      key: "tags",
      header: "Tags",
      value: (row) => row.tags.join(", "),
      render: (row) => (
        <TaxonomyChipRow items={row.tags.map((name) => ({ name, url: tagIcons.get(name.toLowerCase()) }))} />
      ),
    },
    {
      key: "files",
      header: "Files",
      value: (row) => row.attachmentCount,
      hint: "How many files are attached, and what they come to in total.",
      render: (row) =>
        row.attachmentCount === 0 ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="text-ink">
            {row.attachmentCount} · {formatBytes(row.totalBytes)}
          </span>
        ),
    },
    {
      key: "updated",
      header: "Updated",
      value: (row) => row.updatedAt,
      render: (row) => <span className="text-muted">{row.updatedAt.slice(0, 10)}</span>,
    },
    {
      key: "actions",
      header: "",
      // An action column is not part of the record, so it stays out of the record
      // modal — `components.md` is explicit about this.
      excludeFromRecordView: true,
      render: (row) => (
        <span className="flex flex-wrap gap-2">
          {row.attachmentCount > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowingFiles(row)}
              title={`List the ${row.attachmentCount} file(s) on ${row.title}`}
            >
              Show files
            </Button>
          )}
          {row.attachmentCount > 0 && (
            <Button size="sm" variant="secondary" href={`/api/documents/${row.id}/download`}>
              Download all
            </Button>
          )}
          <Button size="sm" variant="secondary" href={documentsEditorHref(row.id)}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={isPending}
            onClick={() => {
              setPendingDelete(row);
              setAlsoDeleteFiles(false);
              setError(undefined);
            }}
          >
            Delete
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div className={PAGE_CONTAINER}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-2 max-lg:w-full">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                Search
              </span>
              <input
                className={INPUT_CLASS}
                value={searchText}
                placeholder="Title or description"
                onChange={(event) => setSearchText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyFilters({ search: event.currentTarget.value });
                }}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                Category
              </span>
              <select
                className={INPUT_CLASS}
                value={category}
                onChange={(event) => applyFilters({ category: event.target.value })}
              >
                {/* The blank option must exist and must be first: a <select> whose
                    value matches no option silently shows the first one, which would
                    make "no filter" look like the first category. */}
                <option value="">All categories</option>
                {categories.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                Tag
              </span>
              <select
                className={INPUT_CLASS}
                value={tag}
                onChange={(event) => applyFilters({ tag: event.target.value })}
              >
                <option value="">All tags</option>
                {tags.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>

            <Button variant="secondary" onClick={() => applyFilters({})}>
              Apply
            </Button>

            {(search !== "" || category !== "" || tag !== "") && (
              <Button
                variant="secondary"
                onClick={() => {
                  setSearchText("");
                  router.push("/modules/documents");
                }}
              >
                Clear
              </Button>
            )}
          </div>

          <Button variant="primary" href={documentsEditorHref()}>
            File a document
          </Button>
        </div>

        {error && !pendingDelete && (
          <p role="alert" className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-ink">
            {error}
          </p>
        )}

        <DataGrid
          columns={columns}
          rows={documents}
          getRowKey={(row) => row.id}
          storageKey="documents-list"
          emptyMessage="No documents yet. Use “File a document” to add the first one."
          exportFileName="documents"
        />
      </div>

      {showingFiles && (
        <Modal
          title={showingFiles.title}
          description={`${showingFiles.attachmentCount} file(s), ${formatBytes(showingFiles.totalBytes)}`}
          onClose={() => setShowingFiles(undefined)}
          footer={
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                href={`/api/documents/${showingFiles.id}/download`}
              >
                Download all
              </Button>
              <Button variant="secondary" onClick={() => setShowingFiles(undefined)}>
                Close
              </Button>
            </div>
          }
        >
          <FileList files={attachments[showingFiles.id] ?? []} documentId={showingFiles.id} />
        </Modal>
      )}

      {pendingDelete && (
        <Modal
          title="Delete this document?"
          onClose={() => {
            if (!isPending) setPendingDelete(undefined);
          }}
          footer={
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={isPending}
                onClick={() => setPendingDelete(undefined)}
              >
                Cancel
              </Button>
              <Button variant="danger" disabled={isPending} onClick={confirmDelete}>
                {isPending ? "Deleting…" : "Delete"}
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-ink">
              <strong>{pendingDelete.title}</strong> will be removed from the library.
            </p>

            {pendingDelete.attachmentCount > 0 && (
              <>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={alsoDeleteFiles}
                    onChange={(event) => setAlsoDeleteFiles(event.target.checked)}
                  />
                  <span className="text-ink">
                    Also delete its {pendingDelete.attachmentCount}{" "}
                    {pendingDelete.attachmentCount === 1 ? "file" : "files"}
                  </span>
                </label>
                <p className="text-xs text-muted">
                  {alsoDeleteFiles
                    ? "The files are moved to a _deleted folder on the server, not erased — you can still recover them by hand."
                    : "The files stay on the server exactly where they are. Only the record goes."}
                </p>
              </>
            )}

            {error && (
              <p role="alert" className="rounded-md border border-line bg-paper px-3 py-2 text-ink">
                {error}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

/**
 * One document's files, each a link that opens it.
 *
 * A real `<a target="_blank">`, not a button: opening a file is navigation, so
 * middle-click, ⌘-click and "save link as" should all behave normally. The serving
 * route decides what happens next — it sends `Content-Disposition: inline` for a PDF
 * or an image, so those open in the browser's own viewer, and `attachment` for
 * everything else, which downloads. That decision lives in `isInlineRenderable` on the
 * server; the same function is read here only to *label* the row honestly, so a reader
 * knows before clicking whether a file will open or land in Downloads.
 *
 * Local to this screen rather than shared: it is a list with links, and the editor's
 * equivalent is `FileUploaderZone`, which does a different job (removing, adding).
 */
function FileList({ files, documentId }: { files: DocumentAttachment[]; documentId: number }) {
  if (files.length === 0) {
    // Reachable if the files were removed in another tab since this page rendered —
    // the button only shows when the count is above zero.
    return <p className="text-sm text-muted">This document has no files.</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {files.map((file) => {
        const opens = isInlineRenderable(file.mimeType);
        return (
          <li key={file.id}>
            <a
              href={`/api/documents/${documentId}/attachments/${file.id}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper px-3 py-2 text-sm hover:border-brass"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-ink" title={file.originalName}>
                  {file.originalName}
                </span>
                <span className="text-xs text-muted">
                  {formatBytes(file.byteSize)} · {opens ? "opens in a new tab" : "downloads"}
                </span>
              </span>
              <span aria-hidden="true" className="shrink-0 text-muted">
                {opens ? "↗" : "↓"}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
