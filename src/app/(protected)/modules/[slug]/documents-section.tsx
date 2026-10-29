import { CollapsibleCard } from "@/components/collapsible-card";
import {
  getDocument,
  listAttachmentsFor,
  listCategories,
  listDocuments,
  listTags,
  type DocumentAttachment,
  type DocumentWithAttachments,
} from "@/lib/documents";
import { deps } from "@/lib/wiring";
import { DocumentsConfigurationView } from "./documents-configuration-view";
import { DocumentsEditorView } from "./documents-editor-view";
import { DocumentsInstructions } from "./documents-instructions";
import { DocumentsMainView } from "./documents-main-view";
import { DocumentsMetadataView } from "./documents-metadata-view";
import { DocumentsShell } from "./documents-shell";
import { configuredDocumentRoot, documentLimits } from "./documents-root";
import {
  DOCUMENTS_SECTION_INFO,
  type DocumentsSection as DocumentsSectionName,
} from "./documents-sections";

// Composes one Document Library screen: the shell, a heading, and the body.
// A server component, so it can read `deps` directly and hand plain data to the client
// views. Mirrors clips-section.tsx.
//
// `view` covers the three nav sections plus the two editor routes, which are not
// sections (they are where the form opens) and so carry no nav row and no icon slot.

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

  // Both lists feed the filter chips AND the editor's pick-or-type boxes, from one
  // read — so the two can never offer different vocabularies.
  const needsTaxonomy = view === "main" || view === "metadata" || view === "new" || view === "edit";
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
          {view === "metadata" && (
            <DocumentsMetadataView categories={categories} tags={tags} />
          )}
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
