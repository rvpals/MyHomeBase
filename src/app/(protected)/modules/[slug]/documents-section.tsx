import { CollapsibleCard } from "@/components/collapsible-card";
import {
  DOCUMENT_PREFILL_FIELDS,
  attachTagIcons,
  buildDocumentTree,
  getDocument,
  isInTreeSelection,
  listAttachmentsFor,
  listCategories,
  listDocuments,
  listEnabledPrefillTemplates,
  listPrefillSuggestions,
  listPrefillTemplates,
  listRecycledDocuments,
  listTags,
  findDocumentsForKeyword,
  rankDocumentKeywords,
  treeSelectionFilter,
  type DocumentAttachment,
  type DocumentPrefillField,
  type DocumentWithAttachments,
} from "@/lib/documents";
import { deps } from "@/lib/wiring";
import { DocumentsConfigurationView } from "./documents-configuration-view";
import { DocumentsEditorView } from "./documents-editor-view";
import { DocumentsInstructions } from "./documents-instructions";
import { DocumentsMainView } from "./documents-main-view";
import { DocumentsMetadataView } from "./documents-metadata-view";
import { DocumentsKeywordsView } from "./documents-keywords-view";
import { DocumentsRecycleView } from "./documents-recycle-view";
import { DocumentsShell } from "./documents-shell";
import { DocumentsTemplatesView } from "./documents-templates-view";
import { DocumentsTreeView } from "./documents-tree-view";
import { configuredDocumentRoot, documentLimits, ignoredKeywords } from "./documents-root";
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
  searchContents = false,
  category,
  tag,
  keyword,
  documentId,
  treeDocumentId,
  isAdmin = false,
}: {
  view: DocumentsView;
  /** The list's filters, parsed from search params by the route so they survive a
      refresh and a bookmark — not client state. */
  search?: string;
  /** From `?contents=1` — whether `search` also looks inside the filed files. */
  searchContents?: boolean;
  category?: string;
  tag?: string;
  /**
   * From `?keyword=` on the Keywords screen — which ranked word's documents to list.
   *
   * A separate param from `?search=`: that one is the reader's own typed text and is
   * matched with LIKE, this one is a word that came out of the ranker and is matched
   * on exactly the rule that ranked it. Collapsing them would make the keyword list
   * and its own drill-down able to disagree about a count.
   */
  keyword?: string;
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
          searchContents,
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

  // The keyword ranking, read only on its own screen — it tokenizes every cached
  // extraction, so no other view may pay for it. `rankDocumentKeywords` caps its own
  // scan (see `KEYWORD_SCAN_LIMIT`) and reports through `scanLimited` when it bound,
  // which the view says out loud rather than under-reporting quietly.
  // The household's own dismissals, layered on top of the shared stopword list. Read
  // only on this screen — no other view ranks words, so no other view pays for it.
  const ignored = view === "keywords" ? ignoredKeywords() : [];

  const keywordRanking =
    view === "keywords"
      ? rankDocumentKeywords(deps.documentsRepo, { excludedWords: ignored })
      : { keywords: [], totalWords: 0, documentsScanned: 0, scanLimited: false };

  // The documents behind the picked word, and only when one is picked: with no
  // `?keyword=` the right pane shows its resting state rather than an empty grid, so
  // there is nothing to look up.
  const keywordDocuments =
    view === "keywords" && keyword !== undefined && keyword !== ""
      ? findDocumentsForKeyword(deps.documentsRepo, keyword)
      : [];

  // The bin, read only on its own screen: it is a separate table, so nothing else
  // pays for it.
  const recycled = view === "recycled" ? listRecycledDocuments(deps.documentsRepo) : [];

  // Prefill templates: the whole list on the Templates screen, the enabled ones for
  // the New Document form's picker. `edit` deliberately gets neither — prefilling a
  // document that already exists is a different gesture, and offering it there would
  // invite a filer to half-overwrite something they filed months ago.
  const prefillTemplates =
    view === "templates"
      ? listPrefillTemplates(deps.documentsRepo)
      : view === "new"
        ? listEnabledPrefillTemplates(deps.documentsRepo)
        : [];

  // Suggestions are read here, on the server, and handed down as plain data — one
  // read per suggesting field rather than a round trip each time the editor's
  // dropdown changes. Both lists are small (the managed category/tag lists) so
  // shipping them costs less than the actions would.
  const prefillSuggestions =
    view === "templates"
      ? (Object.fromEntries(
          DOCUMENT_PREFILL_FIELDS.map((entry) => [
            entry.field,
            listPrefillSuggestions(deps.documentsRepo, entry.field),
          ]),
        ) as Record<DocumentPrefillField, string[]>)
      : ({} as Record<DocumentPrefillField, string[]>);

  // Both lists feed the filter chips AND the editor's pick-or-type boxes, from one
  // read — so the two can never offer different vocabularies.
  const needsTaxonomy =
    view === "main" ||
    view === "tree" ||
    // The keyword drill-down draws the same category and tag chips the other lists
    // do, so it needs the same vocabulary and the same uploaded icons.
    view === "keywords" ||
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
              searchContents={searchContents}
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
          {view === "keywords" && (
            <DocumentsKeywordsView
              keywords={keywordRanking.keywords}
              totalWords={keywordRanking.totalWords}
              documentsScanned={keywordRanking.documentsScanned}
              scanLimited={keywordRanking.scanLimited}
              selectedKeyword={keyword ?? ""}
              matchingDocuments={keywordDocuments}
              ignoredKeywords={ignored}
              categories={categories}
              tags={tags}
            />
          )}
          {view === "metadata" && (
            <DocumentsMetadataView categories={categories} tags={tags} />
          )}
          {view === "templates" && (
            <DocumentsTemplatesView
              templates={prefillTemplates}
              suggestions={prefillSuggestions}
            />
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
              prefillTemplates={prefillTemplates}
            />
          )}
        </div>
      </div>
    </DocumentsShell>
  );
}
