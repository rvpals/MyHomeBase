"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BulkConfirm } from "@/components/bulk-confirm";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import {
  DownloadAllGlyph,
  FilesGlyph,
  PenGlyph,
  XGlyph,
} from "@/components/document-action-icons";
import { Modal } from "@/components/modal";
import { RowActionBar, type RowAction } from "@/components/row-action-bar";
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
import { DocumentsBulkEdit } from "./documents-bulk-edit";
import {
  bulkRecycleAction,
  bulkSetTaxonomyAction,
  deleteDocumentAction,
  extractDocumentTextAction,
  listDocumentTextAction,
  type ExtractTextActionResult,
  type StoredAttachmentText,
} from "./documents-actions";
import { documentsEditorHref } from "./documents-sections";

// Documents → Home screen. The list, its filters, and the way in to the editor.
//
// There is no separate "All documents" route: this IS the list. A second screen
// showing the same rows behind a different nav row would be the same screen twice —
// the shape Clips settled on when it absorbed its own `all` section.
//
// The four row actions are a `RowActionBar` docked into the Title cell, revealed on
// hover — there is no actions column. A column of four buttons was dead weight on
// every row the reader was not pointing at, and it was the first thing to wrap on a
// phone. The bar is *not* a shell floating component: it is a control on an existing
// surface, scoped to one row, with no reader-facing switch and no persisted id.
//
// Narrow: `DataGrid` delegates to `DataGridCompact` below 1024px, so each document
// becomes a card with the same columns stacked. The filter row wraps via `max-lg:`,
// and the dialog is the shared `Modal`, which is already full-width on a phone. The
// action bar stops floating there and sits statically under the title — a card head
// is exactly where a floating bar would cover the title it belongs to, and touch has
// no hover to reveal it with.

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
  searchContents,
}: {
  documents: DocumentSummary[];
  /** Each document's files, keyed by id. Absent means none — see `listAttachmentsFor`. */
  attachments: Record<number, DocumentAttachment[]>;
  categories: DocumentTaxonomyItem[];
  tags: DocumentTaxonomyItem[];
  search: string;
  category: string;
  tag: string;
  /** Whether the search also looks inside the filed files (migration 0165). */
  searchContents: boolean;
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
  const [error, setError] = useState<string>();
  /** The outcome of the last bulk action, shown until the next one. */
  const [notice, setNotice] = useState<string>();
  /** A pending bulk recycle: the ticked rows and how to clear them afterwards. */
  const [bulkConfirm, setBulkConfirm] = useState<{
    rows: DocumentSummary[];
    clearSelection: () => void;
  }>();
  /** A pending bulk taxonomy edit, same shape. */
  const [bulkEdit, setBulkEdit] = useState<{
    rows: DocumentSummary[];
    clearSelection: () => void;
  }>();
  /**
   * Which document's OCR is running, by id — the busy state the button reads.
   *
   * An id rather than a boolean so only the pressed row shows "…", while every other
   * OCR button disables. One extraction at a time is deliberate: OCR holds ~320MB of
   * RSS on the dev box and the NAS has 2GB, so two at once is how this feature would
   * take the app down.
   */
  const [ocrBusy, setOcrBusy] = useState<number>();
  /** The finished run, shown in the results dialog until dismissed. */
  const [ocrResult, setOcrResult] = useState<{
    row: DocumentSummary;
    result: ExtractTextActionResult;
  }>();
  /** Whether the dialog is showing the extracted text itself, not just the summary. */
  const [showFullText, setShowFullText] = useState(false);

  /**
   * Reads one document's files, OCR'ing any that have no text layer.
   *
   * `await` straight through rather than `startTransition`: this is the one action in
   * the module that genuinely takes seconds, and the reader is told so by the button's
   * busy state. Wrapping it in a transition would leave the row looking idle while the
   * server spent four seconds on it.
   */
  async function runOcr(row: DocumentSummary) {
    setOcrBusy(row.id);
    setError(undefined);
    setShowFullText(false);
    try {
      const result = await extractDocumentTextAction(row.id, true);
      if (!result.ok) {
        setError(result.error ?? "That document's text could not be read.");
        return;
      }
      setOcrResult({ row, result });
      // The badge is server-rendered from `textState`, so a run that recovered text
      // has to re-fetch the row or the mark stays stale until the next navigation.
      // Only when something was actually read: a pass that found nothing changes no
      // row, and refreshing would discard the reader's filters to redraw an
      // identical list.
      if (result.files?.some((file) => file.status === "extracted" && !file.fromCache)) {
        router.refresh();
      }
    } catch {
      // A thrown action means the request itself failed — a dropped connection, or a
      // server that restarted mid-extraction. The reader gets a sentence, not a stack.
      setError("The text extraction did not finish. Check the server and try again.");
    } finally {
      setOcrBusy(undefined);
    }
  }

  function applyFilters(next: {
    search?: string;
    category?: string;
    tag?: string;
    contents?: boolean;
  }) {
    const params = new URLSearchParams();
    const value = { search: searchText, category, tag, contents: searchContents, ...next };
    if (value.search.trim() !== "") params.set("search", value.search.trim());
    if (value.category !== "") params.set("category", value.category);
    if (value.tag !== "") params.set("tag", value.tag);
    // Carried in the URL like every other filter, so a contents search can be
    // bookmarked and survives a refresh. Absent when off, which keeps the common
    // URL unchanged from before this existed.
    if (value.contents) params.set("contents", "1");
    const query = params.toString();
    router.push(query === "" ? "/modules/documents" : `/modules/documents?${query}`);
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setError(undefined);
    startTransition(async () => {
      const result = await deleteDocumentAction(id);
      if (!result.ok) {
        setError(result.error ?? "Could not delete that document.");
        return;
      }
      setPendingDelete(undefined);
      router.refresh();
    });
  }

  /** Moves a ticked selection to the bin. */
  function recycleSelection(rows: DocumentSummary[], clearSelection: () => void) {
    setError(undefined);
    startTransition(async () => {
      const result = await bulkRecycleAction(rows.map((row) => row.id));
      if (!result.ok) {
        setError(result.error ?? "Could not delete those documents.");
        return;
      }
      setBulkConfirm(undefined);
      setNotice(result.message);
      clearSelection();
      router.refresh();
    });
  }

  /** Applies one taxonomy change to a ticked selection. */
  function applyBulkTaxonomy(
    rows: DocumentSummary[],
    field: "categories" | "tags",
    mode: "add" | "remove" | "replace",
    names: string[],
    clearSelection: () => void,
  ) {
    setError(undefined);
    startTransition(async () => {
      const result = await bulkSetTaxonomyAction({
        ids: rows.map((row) => row.id),
        field,
        mode,
        names,
      });
      if (!result.ok) {
        setError(result.error ?? "Could not apply that change.");
        return;
      }
      setBulkEdit(undefined);
      setNotice(result.message);
      clearSelection();
      router.refresh();
    });
  }

  /**
   * The four row actions, in reading order.
   *
   * All four are rendered on every row, with the two file actions *disabled* at
   * zero files rather than hidden. A bar that is four wide on one row and two wide
   * on the next reads as broken, and the buttons no longer carry labels to explain
   * the difference — so the width is held steady and the hint says why the pair is
   * out. (The old labelled column could afford to hide them; a floating bar cannot.)
   *
   * Download is an `href`, not an `onClick`: it is a real navigation to the zip
   * route, and should behave like one.
   */
  function documentActions(row: DocumentSummary): RowAction[] {
    const hasFiles = row.attachmentCount > 0;
    const files = `${row.attachmentCount} file(s)`;
    return [
      {
        key: "files",
        icon: <FilesGlyph className="h-4 w-4" />,
        hint: hasFiles
          ? `Show the ${files} and folders on “${row.title}”`
          : `No files on “${row.title}”`,
        onClick: () => setShowingFiles(row),
        isDisabled: !hasFiles,
      },
      {
        key: "download",
        icon: <DownloadAllGlyph className="h-4 w-4" />,
        hint: hasFiles
          ? `Download all ${files} on “${row.title}”`
          : `No files to download on “${row.title}”`,
        href: `/api/documents/${row.id}/download`,
        isDisabled: !hasFiles,
      },
      {
        key: "edit",
        icon: <PenGlyph className="h-4 w-4" />,
        hint: `Edit “${row.title}”`,
        href: documentsEditorHref(row.id),
      },
      {
        key: "delete",
        icon: <XGlyph className="h-4 w-4" />,
        hint: `Move “${row.title}” to the bin`,
        onClick: () => {
          setPendingDelete(row);
          setError(undefined);
        },
        isDanger: true,
        isDisabled: isPending,
      },
    ];
  }

  const titleColumn: DataGridColumn<DocumentSummary> = {
    key: "title",
    header: "Title",
    value: (row) => row.title,
    // The cell draws the description under the title, so the search box has to
    // see it too — otherwise a word the user is looking straight at finds
    // nothing. It stays out of `value` so Title still sorts and exports as the
    // title alone.
    searchValue: (row) => row.description,
    // The list cell: the title, plus the action bar docked into its corner.
    //
    // `group relative` is what the bar positions and reveals against, and it is
    // deliberately the *whole title cell* rather than the title text — the cell is
    // the full width of the column, so the bar lands at the column's right edge
    // and the pointer has the whole cell to trigger it. See `RowActionBar`: the
    // caller owns the hover because only the caller knows how far it should reach.
    //
    // `pr-24` reserves the bar's own width on wide screens so a long title slides
    // out from under it instead of being covered. On compact the bar is static
    // (see below), so the reservation comes off with `max-lg:pr-0`.
    render: (row) => (
      <div className="group relative flex flex-col pr-24 max-lg:pr-0">
        {renderTitleBody(row)}
        {/*
          Narrow: the bar stops floating. Hover does not exist on touch, and a
          card head is exactly where a floating bar would cover the title it is
          meant to belong to — so on compact it drops to its own line under the
          title, statically, always visible. A `max-lg:` restyle rather than a
          component fork: the desktop classes are untouched, so a wide screen
          provably cannot regress. The `@media (hover: none)` rule in
          `globals.css` is what makes it reachable on a touch *laptop*, where
          `max-lg:` never fires.
        */}
        <RowActionBar
          label={`Actions for “${row.title}”`}
          className="max-lg:pointer-events-auto max-lg:relative max-lg:mt-2 max-lg:self-start max-lg:opacity-100"
          actions={documentActions(row)}
        />
      </div>
    ),
    // The record modal gets the same content with no controls: Edit and Delete do
    // not belong in a read-out of one record, which is the rule the old actions
    // column honoured with `excludeFromRecordView`.
    renderRecord: (row) => <div className="flex flex-col">{renderTitleBody(row)}</div>,
  };

  /**
   * The Title cell's content, without the wrapper or the action bar.
   *
   * Shared by the list cell and the record modal so the two can differ in exactly
   * one thing — whether the actions are there — rather than being two copies of a
   * title, a pair of text badges and an OCR button that would drift apart.
   *
   * The OCR control stays here rather than moving into the new bar: it acts on
   * *this document's text*, which is what the title names, and it carries a busy
   * state and a label that changes with `textState`. An icon-only button in a
   * hover bar could show neither.
   */
  function renderTitleBody(row: DocumentSummary) {
    return (
      <>
        <span className="flex items-center gap-2">
          <span className="text-ink">{row.title}</span>
          {/*
            The OCR button sits inline beside the title rather than joining the
            `RowActionBar`, because it acts on *this document's text*, which is what
            the title names — and because it carries two things an icon-only button
            in a hover bar could not show: a busy state ("…") and a label that turns
            from "OCR" into "Re-read" once the text has been read.

            Hidden entirely for a document with no files: "read the text of nothing"
            is not an action, and a disabled button would invite a click that can
            never do anything. (The bar's two file actions take the opposite line and
            disable instead — it holds the bar's width steady, which matters for a
            floating control and not for an inline one.)
          */}
          {/*
            What this document's text is, before the control that changes it. Two
            marks rather than one: "searchable" says the contents can be found,
            "OCR" adds that some of it was *recognised* rather than read exactly —
            which is what a reader needs to know before trusting a surprising hit.
  
            Nothing is drawn for an unindexed document. An absent badge is the
            quiet state here, and a row of grey "not indexed" chips down a library
            nobody has indexed yet would be noise, not information.
          */}
          {row.textState !== "none" && (
            <span
              title={
                row.textState === "ocr"
                  ? "Searchable. Some of this text was read by OCR, so it may contain recognition errors."
                  : "Searchable. The text was read exactly, from the files' own text layer."
              }
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                row.textState === "ocr"
                  ? "bg-amber-400/15 text-amber-300"
                  : "bg-emerald-400/15 text-emerald-300"
              }`}
            >
              {row.textState === "ocr" ? "OCR" : "Searchable"}
            </span>
          )}
          {row.attachmentCount > 0 && (
            <button
              type="button"
              onClick={() => runOcr(row)}
              disabled={ocrBusy !== undefined}
              title={
                row.textState === "none"
                  ? `Read the text inside the ${row.attachmentCount} file(s) on ${row.title}`
                  : `Read ${row.title} again — already-read files are reused, so only new or changed ones cost time`
              }
              className="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted transition-colors hover:border-brass hover:text-brass disabled:cursor-not-allowed disabled:opacity-40"
            >
              {ocrBusy === row.id ? "…" : row.textState === "none" ? "OCR" : "Re-read"}
            </button>
          )}
        </span>
        {row.description !== "" && (
          <span className="truncate text-xs text-muted" title={row.description}>
            {row.description}
          </span>
        )}
      </>
    );
  }

  // There is no actions column any more. The four buttons it carried are the
  // `RowActionBar` docked into the Title cell above — a column of controls was dead
  // weight on every row the reader was not pointing at, and it was the first thing
  // to wrap on a phone.
  const columns: DataGridColumn<DocumentSummary>[] = [
    titleColumn,
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
                placeholder={searchContents ? "Title, description or contents" : "Title or description"}
                onChange={(event) => setSearchText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyFilters({ search: event.currentTarget.value });
                }}
              />
            </label>

            {/*
              Opt-in, not always-on: searching contents widens the result set, since a
              word mentioned once inside a 40-page scan is a weaker hit than the same
              word in a title. A reader who never touches this sees exactly the
              behaviour the module had before.

              It only matches files that have already been read — the toggle never
              triggers an extraction, because a search box that could spend seconds per
              unindexed file would be unusable.
            */}
            <label className="flex items-center gap-2 pb-2 max-lg:w-full">
              <input
                type="checkbox"
                checked={searchContents}
                onChange={(event) => applyFilters({ contents: event.target.checked })}
                className="size-4 accent-[var(--brass)]"
              />
              <span className="text-xs font-medium uppercase tracking-wide text-muted">
                Search inside files
              </span>
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

            {(search !== "" || category !== "" || tag !== "" || searchContents) && (
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

        {notice && (
          <p className="rounded-md border border-line bg-paper px-3 py-2 text-sm text-muted">
            {notice}
          </p>
        )}

        <DataGrid
          columns={columns}
          rows={documents}
          getRowKey={(row) => row.id}
          storageKey="documents-list"
          emptyMessage="No documents yet. Use “File a document” to add the first one."
          exportFileName="documents"
          enableSelection
          renderSelectionActions={(selectedRows, clearSelection) => (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={isPending}
                onClick={() => setBulkEdit({ rows: selectedRows, clearSelection })}
              >
                Categories &amp; tags
              </Button>
              <Button
                variant="danger"
                disabled={isPending}
                onClick={() => setBulkConfirm({ rows: selectedRows, clearSelection })}
              >
                Delete
              </Button>
            </div>
          )}
        />
      </div>

      {/*
        The OCR result. A dialog rather than an inline panel because the extracted
        text of a lab report is thousands of characters — it would push the rest of
        the list off the screen, and the reader asked a question about one row.
      */}
      {ocrResult && (
        <Modal
          title={`Text in ${ocrResult.row.title}`}
          description={ocrResult.result.summary}
          onClose={() => setOcrResult(undefined)}
          footer={
            <div className="flex justify-end gap-2">
              {ocrResult.result.files?.some((file) => file.text !== "") && (
                <Button variant="secondary" onClick={() => setShowFullText((shown) => !shown)}>
                  {showFullText ? "Hide full text" : "Show full text"}
                </Button>
              )}
              <Button onClick={() => setOcrResult(undefined)}>Close</Button>
            </div>
          }
        >
          <div className="flex flex-col gap-3">
            {ocrResult.result.files?.map((file) => (
              <div key={file.attachmentId} className="rounded border border-line p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="truncate text-sm text-ink" title={file.originalName}>
                    {file.originalName}
                  </span>
                  {/*
                    The time is the point of the exercise — it is what says whether
                    this is worth running over a whole library on the NAS.
                  */}
                  <span className="text-xs text-muted">
                    {file.fromCache ? "already read" : file.elapsed}
                  </span>
                </div>

                <div className="mt-1 text-xs text-muted">
                  {file.status === "extracted" && (
                    <>
                      {/*
                        Which path produced this matters: a text layer is exact, OCR is
                        a reading. A reader looking at a surprising result deserves to
                        know which one they are looking at.
                      */}
                      {file.source === "ocr" ? "Read by OCR" : "Read from the text layer"}
                      {file.pageCount > 0 && ` · ${file.pageCount} page(s)`}
                      {` · ${file.charCount.toLocaleString()} characters`}
                      {file.confidence !== undefined &&
                        ` · ${Math.round(file.confidence)}% confidence`}
                    </>
                  )}
                  {file.status === "needs-ocr" && "No text layer, and OCR could not read it."}
                  {file.status === "unsupported" && "Nothing readable in this file."}
                  {file.status === "failed" && (
                    <span className="text-danger">{file.error}</span>
                  )}
                </div>

                {showFullText && file.text !== "" && (
                  // `whitespace-pre-wrap` keeps the document's own lines, which is what
                  // makes an extracted table still readable as a table. Scrolled rather
                  // than truncated: the reader asked to see the full text.
                  <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-paper-raised p-2 text-xs text-ink">
                    {file.text}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}

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

      {bulkConfirm && (
        <BulkConfirm
          title="Move these documents to the bin?"
          count={bulkConfirm.rows.length}
          noun={{ one: "document", many: "documents" }}
          caveat="They go to Recycled Documents with their files, and can be restored from there."
          confirmLabel="Move to bin"
          isBusy={isPending}
          onConfirm={() => recycleSelection(bulkConfirm.rows, bulkConfirm.clearSelection)}
          onCancel={() => setBulkConfirm(undefined)}
        />
      )}

      {bulkEdit && (
        <DocumentsBulkEdit
          count={bulkEdit.rows.length}
          categories={categories.map((item) => item.name)}
          tags={tags.map((item) => item.name)}
          isBusy={isPending}
          onCancel={() => setBulkEdit(undefined)}
          onApply={(field, mode, names) =>
            applyBulkTaxonomy(bulkEdit.rows, field, mode, names, bulkEdit.clearSelection)
          }
        />
      )}

      {pendingDelete && (
        <Modal
          title="Move this document to the bin?"
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
              <strong>{pendingDelete.title}</strong> will be moved to{" "}
              <strong>Recycled Documents</strong>, where you can restore it.
            </p>

            {pendingDelete.attachmentCount > 0 && (
              <p className="text-xs text-muted">
                Its {pendingDelete.attachmentCount}{" "}
                {pendingDelete.attachmentCount === 1 ? "file goes" : "files go"} with it and
                come back on a restore.
              </p>
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
  /**
   * The stored text, fetched once when the first file's text is opened.
   *
   * Lazily, and for the whole document rather than per file: the bodies can be
   * thousands of characters each, so loading them with the dialog would make
   * "which files are on this?" pay for text nobody asked to see. One call covers
   * every row because they come from one query anyway.
   */
  const [texts, setTexts] = useState<Map<number, StoredAttachmentText>>();
  const [loadingText, setLoadingText] = useState(false);
  const [textError, setTextError] = useState<string>();
  /** Which files have their text panel open. */
  const [opened, setOpened] = useState<Set<number>>(new Set());

  async function toggleText(attachmentId: number) {
    const next = new Set(opened);
    if (next.has(attachmentId)) {
      next.delete(attachmentId);
      setOpened(next);
      return;
    }
    next.add(attachmentId);
    setOpened(next);

    if (texts !== undefined || loadingText) return;
    setLoadingText(true);
    setTextError(undefined);
    try {
      const result = await listDocumentTextAction(documentId);
      if (!result.ok) {
        setTextError(result.error ?? "That text could not be read.");
        return;
      }
      setTexts(new Map((result.files ?? []).map((row) => [row.attachmentId, row])));
    } catch {
      setTextError("That text could not be read.");
    } finally {
      setLoadingText(false);
    }
  }

  if (files.length === 0) {
    // Reachable if the files were removed in another tab since this page rendered —
    // the button only shows when the count is above zero.
    return <p className="text-sm text-muted">This document has no files.</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {files.map((file) => {
        const opens = isInlineRenderable(file.mimeType);
        const isOpen = opened.has(file.id);
        const stored = texts?.get(file.id);
        return (
          <li key={file.id} className="flex flex-col">
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

            {/*
              Outside the anchor, deliberately: a button nested in a link is invalid
              markup and the click would navigate as well as toggle.
            */}
            <button
              type="button"
              onClick={() => toggleText(file.id)}
              className="mt-1 self-start rounded px-1 text-xs text-muted underline-offset-2 hover:text-brass hover:underline"
            >
              {isOpen ? "Hide extracted text" : "Show extracted text"}
            </button>

            {isOpen && (
              <div className="mt-1 rounded-md border border-line bg-paper-raised p-2">
                {loadingText && <p className="text-xs text-muted">Reading…</p>}
                {textError !== undefined && <p className="text-xs text-danger">{textError}</p>}

                {!loadingText && textError === undefined && stored === undefined && (
                  // No row at all: nothing has read this file yet. Said plainly, with
                  // the two ways to fix it, rather than an empty box.
                  <p className="text-xs text-muted">
                    This file has not been read yet. Use the <strong>OCR</strong> button on the
                    row, or wait for the background indexing job.
                  </p>
                )}

                {stored !== undefined && (
                  <>
                    <p className="mb-2 text-xs text-muted">
                      {stored.status === "extracted" ? (
                        <>
                          {stored.source === "ocr" ? "Read by OCR" : "Read from the text layer"}
                          {stored.pageCount > 0 && ` · ${stored.pageCount} page(s)`}
                          {` · ${stored.charCount.toLocaleString()} characters`}
                          {stored.confidence !== undefined &&
                            ` · ${Math.round(stored.confidence)}% confidence`}
                          {` · indexed ${stored.indexedAt.slice(0, 16)} UTC`}
                        </>
                      ) : stored.status === "failed" ? (
                        <span className="text-danger">{stored.error || "That file failed."}</span>
                      ) : (
                        "Nothing readable was recovered from this file."
                      )}
                    </p>
                    {stored.body !== "" && (
                      // `whitespace-pre-wrap` keeps the document's own lines, which is
                      // what makes an extracted table still read as a table.
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-ink">
                        {stored.body}
                      </pre>
                    )}
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
