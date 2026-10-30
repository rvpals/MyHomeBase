"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/button";
import { DataGrid, type DataGridColumn } from "@/components/data-grid";
import { TaxonomyChipRow, TaxonomyIcon } from "@/components/taxonomy-icon";
// Leaf imports, not the `@/lib/documents` barrel: this is a client component, and
// the barrel re-exports the repository and the file store, which pull in
// `better-sqlite3` and `node:fs/promises`. Neither bundles for a browser. Same
// reasoning as `documents-main-view.tsx`.
import { formatBytes } from "@/lib/documents/schema";
import { isInlineRenderable } from "@/lib/documents/attachment-path";
import { UNCATEGORIZED_ID, type DocumentTreeCategory } from "@/lib/documents/tree";
import type {
  DocumentAttachment,
  DocumentSummary,
  DocumentTaxonomyItem,
} from "@/lib/documents/types";
import { PAGE_CONTAINER } from "../../page-container";
import { documentsEditorHref } from "./documents-sections";

// Documents → Document Tree. The same documents the Home screen lists, reached by
// browsing rather than by searching: categories down the left, the tags actually in
// use beneath each, the matching documents top-right, and the selected document's
// details and files underneath them.
//
// **Read-only.** Every way of changing a document — filing, editing, bulk taxonomy,
// deleting — stays on the Home screen and in the editor. A second editor here would
// be `documents-editor-view.tsx` written twice, and the two would drift.
//
// **The selection is the URL** (`?category=&tag=&doc=`), exactly as the Home screen
// puts its filters there. Not client state: `NavTree` remounts on every navigation,
// so client state would drop the reader's position every time they came back, and a
// tree position you cannot bookmark or reload is one you have to rebuild by hand.
//
// Narrow: the three panes stack (`max-lg:flex-col`), the same fork the SQL Explorer's
// tree uses — two columns on a 390px phone leaves neither pane usable. No new fixed
// bar; the bottom edge belongs to the shared section bar and the music player.

/**
 * Builds a name -> icon-url lookup for the category rows.
 *
 * The tree nodes carry `hasIcon` and `updatedAt` rather than a URL, because building
 * a URL is presentation. `?v=` is the cache-buster: the icon route sends
 * `max-age=300`, so without it a replaced picture would keep showing for five
 * minutes. Keyed lower-case, since the taxonomy tables are `COLLATE NOCASE`.
 */
function iconUrl(
  segment: "categories" | "tags",
  name: string,
  hasIcon: boolean,
  updatedAt: string,
): string | undefined {
  if (!hasIcon) return undefined;
  return `/api/documents/${segment}/${encodeURIComponent(name)}/icon?v=${encodeURIComponent(updatedAt)}`;
}

/** The same lookup for the chips in the list and the detail pane. */
function taxonomyUrls(
  items: DocumentTaxonomyItem[],
  segment: "categories" | "tags",
): Map<string, string> {
  const urls = new Map<string, string>();
  for (const item of items) {
    const url = iconUrl(segment, item.name, item.hasIcon, item.updatedAt);
    if (url) urls.set(item.name.toLowerCase(), url);
  }
  return urls;
}

export function DocumentsTreeView({
  tree,
  documents,
  attachments,
  categories,
  tags,
  selectedCategory,
  selectedTag,
  selectedDocument,
}: {
  /** The category nodes with their in-use tags, built by `buildDocumentTree`. */
  tree: DocumentTreeCategory[];
  /** The documents matching the current selection — already filtered on the server. */
  documents: DocumentSummary[];
  /** Each listed document's files, keyed by id. Absent means none. */
  attachments: Record<number, DocumentAttachment[]>;
  categories: DocumentTaxonomyItem[];
  tags: DocumentTaxonomyItem[];
  /** The selected category node's id, or `""` for none. */
  selectedCategory: string;
  /** The selected tag, or `""` for none. */
  selectedTag: string;
  /** The id of the document shown in the detail pane, or `undefined`. */
  selectedDocument?: number;
}) {
  const router = useRouter();

  const categoryIcons = taxonomyUrls(categories, "categories");
  const tagIcons = taxonomyUrls(tags, "tags");

  const detail = documents.find((row) => row.id === selectedDocument);

  /**
   * Writes a selection into the URL, which is where this screen's state lives.
   *
   * The three callers below differ only in what they *keep*, and that is the whole
   * rule worth stating: a category change drops the tag and the open document,
   * because a tag from the old category usually does not exist under the new one and
   * the document almost certainly is not filed in it. Carrying either across would
   * leave an empty list, or a detail pane for a row no longer on screen.
   */
  function pushSelection(category: string, tag: string, doc: number | undefined) {
    const params = new URLSearchParams();
    if (category !== "") params.set("category", category);
    if (tag !== "") params.set("tag", tag);
    if (doc !== undefined) params.set("doc", String(doc));

    const query = params.toString();
    router.push(query === "" ? "/modules/documents/tree" : `/modules/documents/tree?${query}`);
  }

  /** Clicking a category: the tag and the open document both go with the old one. */
  function selectCategory(category: string) {
    pushSelection(category, "", undefined);
  }

  /**
   * Clicking a tag: the category stays, the open document does not.
   *
   * The list is about to be re-narrowed, and a detail pane showing a row that the
   * new filter excludes is a pane the reader cannot see the source of.
   */
  function selectTag(tag: string) {
    pushSelection(selectedCategory, tag, undefined);
  }

  /** Clicking a document: only the detail pane changes. */
  function selectDocument(doc: number) {
    pushSelection(selectedCategory, selectedTag, doc);
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
      key: "tags",
      header: "Tags",
      value: (row) => row.tags.join(", "),
      render: (row) => (
        <TaxonomyChipRow
          items={row.tags.map((name) => ({ name, url: tagIcons.get(name.toLowerCase()) }))}
        />
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
        <Button
          size="sm"
          variant={row.id === selectedDocument ? "primary" : "secondary"}
          onClick={() => selectDocument(row.id)}
          title={`Show ${row.title} below`}
        >
          {row.id === selectedDocument ? "Showing" : "Show"}
        </Button>
      ),
    },
  ];

  return (
    <div className={PAGE_CONTAINER}>
      {/* Side by side on desktop, stacked below 1024px — the SQL Explorer's split. */}
      <div className="flex gap-4 max-lg:flex-col">
        <div className="shrink-0 overflow-y-auto rounded-md border border-line bg-paper-raised p-2 lg:max-h-[70vh] lg:w-72">
          <CategoryTree
            tree={tree}
            selectedCategory={selectedCategory}
            selectedTag={selectedTag}
            categoryIcons={categoryIcons}
            onSelectCategory={selectCategory}
            onSelectTag={selectTag}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <section className="flex flex-col gap-2">
            <SelectionHeading
              tree={tree}
              selectedCategory={selectedCategory}
              selectedTag={selectedTag}
              count={documents.length}
              onClear={() => pushSelection("", "", undefined)}
            />

            <DataGrid
              columns={columns}
              rows={documents}
              getRowKey={(row) => row.id}
              storageKey="documents-tree-list"
              emptyMessage={
                selectedCategory === ""
                  ? "Pick a category from the tree to see what is filed under it."
                  : "Nothing is filed here. Pick another category or tag."
              }
              exportFileName="documents-tree"
              onRowClick={(row) => selectDocument(row.id)}
            />
          </section>

          {/* The bottom half of the right pane: the selected document, read-only. */}
          <DocumentDetail
            document={detail}
            files={detail ? (attachments[detail.id] ?? []) : []}
            categoryIcons={categoryIcons}
            tagIcons={tagIcons}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The category/tag tree.
 *
 * Local to this screen rather than `TreeNav`, deliberately: `TreeNav`'s group row is
 * a toggle and only its leaves are selectable, and here a category must be **both**
 * clickable and expandable. Widening `TreeNav` with a group-selection mode would
 * change a component whose only other call sites — the SQL Explorer's two tabs —
 * don't want it. If a second module grows a tree like this one, that is the moment
 * to promote this into `src/components/` and register it.
 *
 * The chevron is its own button beside the row, not wrapped around it, so expanding
 * a category and selecting it are separate acts: a reader who wants to see what is
 * filed under Insurance should not have to reveal its tags to do it, and a reader
 * opening the tags should not have the list jump under them.
 */
function CategoryTree({
  tree,
  selectedCategory,
  selectedTag,
  categoryIcons,
  onSelectCategory,
  onSelectTag,
}: {
  tree: DocumentTreeCategory[];
  selectedCategory: string;
  selectedTag: string;
  categoryIcons: Map<string, string>;
  onSelectCategory: (category: string) => void;
  onSelectTag: (tag: string) => void;
}) {
  if (tree.length === 0) {
    return (
      <p className="px-1 py-2 text-sm text-muted">
        No categories yet. Add one on Categories &amp; Tags, or file a document under a
        new one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2.5" role="tree">
      {tree.map((node) => {
        // Expansion follows the selection rather than being its own state: the tags
        // under a category are only reachable once that category is the one being
        // looked at, so a second piece of state could only ever disagree with it —
        // and it would reset on every navigation anyway, since the selection lives
        // in the URL and this component remounts with the route.
        const isSelected = node.id === selectedCategory;
        const url = categoryIcons.get(node.name.toLowerCase());

        return (
          <div
            key={node.id}
            className="card-embossed overflow-hidden rounded-lg border border-line bg-paper-raised"
          >
            <button
              type="button"
              role="treeitem"
              aria-expanded={isSelected}
              aria-selected={isSelected}
              onClick={() => onSelectCategory(isSelected ? "" : node.id)}
              className={`flex w-full items-center gap-2 px-2.5 py-2 text-left text-sm transition-colors hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass ${
                isSelected
                  ? "shell-accent-text border-b border-line bg-brass-soft font-semibold"
                  : "font-medium text-ink"
              }`}
            >
              <span
                aria-hidden
                className={`shrink-0 text-xs text-muted transition-transform ${isSelected ? "rotate-90" : ""}`}
              >
                ▶
              </span>
              {node.id === UNCATEGORIZED_ID ? (
                <span aria-hidden className="shrink-0 text-muted">
                  —
                </span>
              ) : (
                <TaxonomyIcon url={url} name={node.name} size="sm" />
              )}
              <span className="min-w-0 flex-1 truncate">{node.label}</span>
              <span className="shrink-0 font-mono text-xs font-normal text-muted">
                {node.count}
              </span>
            </button>

            {isSelected && (
              <div role="group" className="px-2.5 py-2">
                {node.tags.length === 0 ? (
                  <p className="text-xs text-muted">
                    {node.count === 0
                      ? "Nothing is filed here yet."
                      : "No tags on these documents."}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {node.tags.map((tag) => {
                      const isTagSelected = tag.name.toLowerCase() === selectedTag.toLowerCase();
                      return (
                        <li key={tag.name}>
                          <button
                            type="button"
                            role="treeitem"
                            aria-selected={isTagSelected}
                            onClick={() => onSelectTag(isTagSelected ? "" : tag.name)}
                            className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass ${
                              isTagSelected
                                ? "shell-accent-text bg-brass-soft font-semibold"
                                : "text-ink"
                            }`}
                          >
                            <TaxonomyIcon
                              url={iconUrl("tags", tag.name, tag.hasIcon, tag.updatedAt)}
                              name={tag.name}
                              size="sm"
                            />
                            <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                            <span className="shrink-0 font-mono text-[0.625rem] font-normal text-muted">
                              {tag.count}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** What the list is currently showing, in words, with a way back to everything. */
function SelectionHeading({
  tree,
  selectedCategory,
  selectedTag,
  count,
  onClear,
}: {
  tree: DocumentTreeCategory[];
  selectedCategory: string;
  selectedTag: string;
  count: number;
  onClear: () => void;
}) {
  const node = tree.find((item) => item.id === selectedCategory);
  const label = node?.label ?? selectedCategory;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-display text-lg text-ink">
        {selectedCategory === "" ? (
          "All documents"
        ) : (
          <>
            {label}
            {selectedTag !== "" && <span className="text-muted"> › {selectedTag}</span>}
          </>
        )}
        <span className="ml-2 font-mono text-sm font-normal text-muted">{count}</span>
      </h2>

      {(selectedCategory !== "" || selectedTag !== "") && (
        <Button size="sm" variant="secondary" onClick={onClear}>
          Show all
        </Button>
      )}
    </div>
  );
}

/**
 * The selected document, read-only, in the bottom half of the right pane.
 *
 * Its fields and its files. Editing lives in the editor, one click away — building a
 * form here would duplicate `documents-editor-view.tsx` and give the module two
 * places where a document can be changed.
 */
function DocumentDetail({
  document,
  files,
  categoryIcons,
  tagIcons,
}: {
  document?: DocumentSummary;
  files: DocumentAttachment[];
  categoryIcons: Map<string, string>;
  tagIcons: Map<string, string>;
}) {
  if (!document) {
    return (
      <section className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-muted">
        Pick a document above to read its details and files here.
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-line bg-paper-raised p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-lg text-ink">{document.title}</h3>
          {document.description !== "" && (
            <p className="mt-0.5 text-sm text-muted">{document.description}</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {document.attachmentCount > 0 && (
            <Button size="sm" variant="secondary" href={`/api/documents/${document.id}/download`}>
              Download all
            </Button>
          )}
          <Button size="sm" variant="secondary" href={documentsEditorHref(document.id)}>
            Edit
          </Button>
        </div>
      </div>

      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">Categories</dt>
          <dd className="min-w-0">
            {document.categories.length === 0 ? (
              <span className="text-muted">—</span>
            ) : (
              <TaxonomyChipRow
                limit={6}
                items={document.categories.map((name) => ({
                  name,
                  url: categoryIcons.get(name.toLowerCase()),
                }))}
              />
            )}
          </dd>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">Tags</dt>
          <dd className="min-w-0">
            {document.tags.length === 0 ? (
              <span className="text-muted">—</span>
            ) : (
              <TaxonomyChipRow
                limit={6}
                items={document.tags.map((name) => ({
                  name,
                  url: tagIcons.get(name.toLowerCase()),
                }))}
              />
            )}
          </dd>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">Updated</dt>
          <dd className="text-ink">{document.updatedAt.slice(0, 10)}</dd>
        </div>
      </dl>

      <TreeFileList files={files} documentId={document.id} />
    </section>
  );
}

/**
 * One document's files, each a link that opens it.
 *
 * A real `<a target="_blank">`, not a button: opening a file is navigation, so
 * middle-click, ⌘-click and "save link as" all behave normally. The serving route
 * decides what happens — `Content-Disposition: inline` for a PDF or an image,
 * `attachment` for everything else. That decision lives in `isInlineRenderable` on
 * the server; it is read here only to *label* the row, so a reader knows before
 * clicking whether a file opens or lands in Downloads.
 *
 * A near-twin of `FileList` in `documents-main-view.tsx`, which draws the same rows
 * inside that screen's modal. Left as two small local copies rather than lifted into
 * `src/components/`: the pair is ~30 lines of markup, and the two will plausibly
 * diverge — the modal's is the whole dialog body, this one sits under a record.
 * Promote it on the third caller.
 */
function TreeFileList({ files, documentId }: { files: DocumentAttachment[]; documentId: number }) {
  if (files.length === 0) {
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
