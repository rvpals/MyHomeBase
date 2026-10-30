import { CollapsibleCard } from "@/components/collapsible-card";
import {
  attachTagIcons,
  buildDocumentTree,
  getDocument,
  isInTreeSelection,
  listAttachmentsFor,
  listCategories,
  listDocuments,
  listRecycledDocuments,
  listTags,
  treeSelectionFilter,
  type DocumentAttachment,
  type DocumentWithAttachments,
} from "@/lib/documents";
import { deps } from "@/lib/wiring";
import { DocumentsConfigurationView } from "./documents-configuration-view";
import { DocumentsEditorView } from "./documents-editor-view";
import { DocumentsInstructions } from "./documents-instructions";
import { DocumentsMainView } from "./documents-main-view";
import { DocumentsMetadataView } from "./documents-metadata-view";
import { DocumentsRecycleView } from "./documents-recycle-view";
import { DocumentsShell } from "./documents-shell";
import { DocumentsTreeView } from "./documents-tree-view";
import { configuredDocumentRoot, documentLimits } from "./documents-root";
import {
  DOCUMENTS_SECTION_INFO,
  type DocumentsSection as DocumentsSectionName,
} from "./documents-sections";

// Composes one Document Library screen: the shell, a heading, and the body.
// A server component, so it can read `deps` directly and hand plain data to the client
// views. Mirrors clips-section.tsx.
//
// `view` covers every nav section plus the two editor routes, which are not sections
// (they are where the form opens) and so carry no nav row and no icon slot.

export type DocumentsView = DocumentsSectionName | "new" | "edit";

/** The editor's heading, since it has no `DOCUMENTS_SECTION_INFO` row. */
const EDITOR_INFO = {
  new: { label: "New document", description: "File a document and attach its files." },
  edit: { label: "Edit document", description: "Change the details, or its attachments." },
} as const;

export async function DocumentsSection({
  view,
  search,
  category,
  tag,
  documentId,
  treeDocumentId,
  isAdmin = false,
}: {
  view: DocumentsView;
  /** The list's filters, parsed from search params by the route so they survive a
      refresh and a bookmark — not client state. */
  search?: string;
  category?: string;
  tag?: string;
  /** From `?id=` on the edit route. */
  documentId?: number;
  /** From `?doc=` on the tree screen — the document shown in its detail pane. */
  treeDocumentId?: number;
  /** Whether this reader may change the module-wide settings. */
  isAdmin?: boolean;
}) {
  const info =
    view === "new" || view === "edit" ? EDITOR_INFO[view] : DOCUMENTS_SECTION_INFO[view];

  // Loaded only for the screen that renders it. `listDocuments` is a projection: it
  // carries the attachment count and total size rather than the attachment rows, so
  // even the unfiltered list costs one query.
  const documents =
    view === "main"
      ? listDocuments(deps.documentsRepo, {
          search: search ?? "",
          categories: category ? [category] : [],
          tags: tag ? [tag] : [],
        })
      : [];

  // The tree screen reads the library TWICE on purpose, and they are different reads.
  //
  // `treeDocuments` is unfiltered, and the tree is built from it: a tree whose counts
  // came from the filtered set would shrink as the reader narrowed, so the node they
  // just clicked would be the only one left and there would be no way back up.
  //
  // `treeRows` is the same read narrowed to the selection, which is what the list pane
  // shows. Both are the one projection `listDocuments` returns — counts and sizes, not
  // attachment rows — so this is two cheap queries, not two expensive ones.
  const treeDocuments = view === "tree" ? listDocuments(deps.documentsRepo) : [];

  const treeRows =
    view === "tree"
      ? listDocuments(deps.documentsRepo, treeSelectionFilter(category, tag))
          // Uncategorized is narrowed here rather than in SQL: the filter schema takes
          // a list of category names, and "has no category at all" is not a name.
          .filter((document) => isInTreeSelection(document, category))
      : [];

  // The files behind the list's "Show files" button, for the whole page in ONE query
  // — `listAttachmentsFor` exists for exactly this. Fetched here rather than on demand
  // because the dialog would otherwise need its own action and a loading state for
  // data that is a single cheap join away.
  const attachmentsByDocument =
    view === "main"
      ? listAttachmentsFor(
          deps.documentsRepo,
          documents.map((document) => document.id),
        )
      : new Map<number, DocumentAttachment[]>();

  // The tree's detail pane needs the files for ONE document, not for the page: it
  // shows a single record at a time, and fetching every listed row's attachments to
  // display one of them is the cost `DocumentSummary` exists to avoid.
  const treeAttachments =
    view === "tree" && treeDocumentId !== undefined
      ? listAttachmentsFor(deps.documentsRepo, [treeDocumentId])
      : new Map<number, DocumentAttachment[]>();

  // The bin, read only on its own screen: it is a separate table, so nothing else
  // pays for it.
  const recycled = view === "recycled" ? listRecycledDocuments(deps.documentsRepo) : [];

  // Both lists feed the filter chips AND the editor's pick-or-type boxes, from one
  // read — so the two can never offer different vocabularies.
  const needsTaxonomy =
    view === "main" ||
    view === "tree" ||
    view === "metadata" ||
    view === "new" ||
    view === "edit";
  const categories = needsTaxonomy ? listCategories(deps.documentsRepo) : [];
  const tags = needsTaxonomy ? listTags(deps.documentsRepo) : [];

  // The full record, only for the editor. `getDocument` fetches the attachments too —
  // a summary deliberately doesn't carry them, and an editor needs every one.
  const existing: DocumentWithAttachments | undefined =
    view === "edit" && documentId !== undefined
      ? getDocument(deps.documentsRepo, documentId)
      : undefined;

  const limits = documentLimits();
  // Read on every screen that can attach a file, so the editor can say "no folder is
  // set" up front rather than after a failed upload.
  const root = configuredDocumentRoot();

  return (
    // The two-tier shell: the navigation tree on a wide screen, the shared bottom bar
    // on a narrow one, both placed by `DocumentsShell`. See design.md, "Navigation:
    // the tree (desktop) and the two-tier bar (compact)".
    <DocumentsShell>
      <div>
        <header className="mb-4">
          <h1 className="font-display text-2xl text-ink">{info.label}</h1>
          <p className="text-sm text-muted">{info.description}</p>
        </header>

        {view !== "new" && view !== "edit" && (
          <CollapsibleCard title="Instruction">
            <DocumentsInstructions section={view} />
          </CollapsibleCard>
        )}

        <div className="mt-4">
          {view === "main" && (
            <DocumentsMainView
              documents={documents}
              // A plain object, not the Map: a Map does not survive the server ->
              // client component boundary, which serializes props as JSON.
              attachments={Object.fromEntries(attachmentsByDocument)}
              categories={categories}
              tags={tags}
              search={search ?? ""}
              category={category ?? ""}
              tag={tag ?? ""}
            />
          )}
          {view === "tree" && (
            <DocumentsTreeView
              // Built from the UNFILTERED read, then given the tag icons from the
              // taxonomy list this page already fetched — so the shaping stays a pure
              // function of the documents and the pictures are layered on after.
              tree={attachTagIcons(buildDocumentTree(categories, treeDocuments), tags)}
              documents={treeRows}
              // A plain object, not the Map: a Map does not survive the server ->
              // client boundary, which serializes props as JSON.
              attachments={Object.fromEntries(treeAttachments)}
              categories={categories}
              tags={tags}
              selectedCategory={category ?? ""}
              selectedTag={tag ?? ""}
              selectedDocument={treeDocumentId}
            />
          )}
          {view === "metadata" && (
            <DocumentsMetadataView categories={categories} tags={tags} />
          )}
          {view === "recycled" && <DocumentsRecycleView documents={recycled} />}
          {view === "configuration" && (
            <DocumentsConfigurationView
              documentRoot={root}
              maxFileBytes={limits.maxFileBytes}
              maxFilesPerDocument={limits.maxFilesPerDocument}
              canEdit={isAdmin}
            />
          )}
          {(view === "new" || view === "edit") && (
            <DocumentsEditorView
              document={existing?.document}
              attachments={existing?.attachments ?? []}
              categories={categories}
              tags={tags}
              maxFileBytes={limits.maxFileBytes}
              maxFilesPerDocument={limits.maxFilesPerDocument}
              isFolderConfigured={root !== ""}
            />
          )}
        </div>
      </div>
    </DocumentsShell>
  );
}
