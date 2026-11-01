import type { DecodedImage } from "@/lib/shared/image-upload";
import type { DocumentFilterInput, DocumentPrefillTemplateWriteData } from "./schema";
import type {
  AttachmentText,
  AttachmentTextSearchHit,
  Document,
  DocumentAttachment,
  DocumentPrefillTemplate,
  DocumentSummary,
  DocumentTaxonomyItem,
  DuplicateMatch,
  RecycledDocument,
} from "./types";

/** What the repository is handed to write a document. Taxonomy arrives already trimmed. */
export interface DocumentWriteData {
  title: string;
  description: string;
  categories: string[];
  tags: string[];
  createdBy: number | null;
}

/** What the repository is handed to store one attachment's recovered text. */
export interface AttachmentTextWriteData {
  attachmentId: number;
  documentId: number;
  body: string;
  status: AttachmentText["status"];
  source: AttachmentText["source"];
  pageCount: number;
  charCount: number;
  confidence?: number;
  elapsedMs: number;
  contentHash: string;
  error: string;
  /** Whether OCR was run to produce this row, whatever it found (migration 0166). */
  ocrAttempted: boolean;
}

/** What the repository is handed to index a newly stored file. */
export interface AttachmentWriteData {
  documentId: number;
  fileName: string;
  originalName: string;
  relativePath: string;
  mimeType: string;
  byteSize: number;
  /** SHA-256 of the bytes, or `""` when not hashed. See `content-hash.ts`. */
  contentHash: string;
}

/**
 * How a bulk taxonomy edit changes one field.
 *
 * Three modes rather than a plain replace, mirroring the journal's bulk edit and for
 * the same reason: a document holds *several* categories and tags, so "add Tax to
 * these twelve" and "replace their categories with Tax" are different intentions and
 * conflating them would silently discard filing the reader meant to keep.
 */
export type BulkTaxonomyMode = "add" | "remove" | "replace";

// The use-cases depend on THIS interface, not on a concrete database. That is what
// lets the web app, the CLI, and tests each supply their own.
export interface DocumentsRepository {
  // Documents
  /**
   * The list, most recently touched first, as summaries — never attachment rows.
   * An empty filter is the unfiltered list.
   */
  listDocuments(filter: DocumentFilterInput): DocumentSummary[];
  /** The full record, for an editor or a viewer. */
  getDocumentById(id: number): Document | undefined;
  createDocument(input: DocumentWriteData): Document;
  /** A full replace of the document's own fields and its taxonomy, not a patch. */
  updateDocument(id: number, input: DocumentWriteData): Document;
  /**
   * Deletes the document, its taxonomy pairings and its attachment **rows**, in one
   * transaction.
   *
   * It does not touch the share: the files are the file store's business, and the
   * use-case sequences the two so a failed move never leaves a record pointing at a
   * file that is no longer where it says.
   */
  deleteDocument(id: number): void;

  // Attachments
  /** One document's attachments, in `(sort_order, id)` order. */
  listAttachments(documentId: number): DocumentAttachment[];
  /**
   * The attachments for many documents in **one** query, keyed by document id.
   *
   * What lets a list screen show a file-type strip per row without N queries — the
   * same shape, and the same reason, as `listClipItemsForClips`. Documents with no
   * attachments are absent from the map.
   */
  listAttachmentsForDocuments(documentIds: number[]): Map<number, DocumentAttachment[]>;
  /** One attachment, for the serving route and for a remove. */
  getAttachmentById(id: number): DocumentAttachment | undefined;
  addAttachment(input: AttachmentWriteData): DocumentAttachment;
  /** Removes the row only. The file is the file store's business — see `deleteDocument`. */
  deleteAttachment(id: number): void;

  // Content hashes (migration 0163)
  /**
   * Every attachment whose bytes hash to this value, with its document's title.
   *
   * Never called with an empty hash — `findDuplicates` guards that, because an empty
   * hash means "never hashed" and would otherwise match every un-backfilled row in
   * the library.
   */
  findAttachmentsByHash(contentHash: string): DuplicateMatch[];
  /** Sets one row's hash. The backfill CLI's only write. */
  setAttachmentHash(id: number, contentHash: string): void;
  /** Attachments still carrying `''`, oldest first — the backfill's work list. */
  listUnhashedAttachments(limit: number): DocumentAttachment[];

  // Bulk operations (migration 0163)
  /**
   * Applies one taxonomy change to many documents in a single transaction.
   *
   * In the repository rather than looped in the use-case because it is one
   * transaction over two pairing tables: a half-applied bulk edit would leave the
   * selection in two different states with nothing to say which rows landed.
   *
   * Returns how many documents were actually touched — ids that no longer exist are
   * skipped, so the count stays honest.
   */
  bulkSetTaxonomy(
    ids: number[],
    field: "categories" | "tags",
    mode: BulkTaxonomyMode,
    names: string[],
  ): number;

  // Recycle bin (migration 0163)
  /**
   * Moves documents into the bin, recording where each one's files went.
   *
   * `deletedFolders` maps a document id to the stamped `_deleted/…` folder its files
   * were moved to, or is absent for a document that had none. The caller moves the
   * files first and hands the destinations in, because the stamp is generated by the
   * file store at the moment of the move and exists nowhere else — see migration 0163.
   */
  recycleDocuments(ids: number[], deletedFolders: Map<number, string>): number;
  /** Everything in the bin, newest deleted first. */
  listRecycledDocuments(): RecycledDocument[];
  /** One bin row, for a restore that needs to know where its files are. */
  getRecycledDocument(recycledId: number): RecycledDocument | undefined;
  /**
   * Puts one binned document back, at `targetId`.
   *
   * The use-case chooses the id (and moves the files to match) because that decision
   * needs the share: a restore landing on a new id has to rewrite every attachment
   * path, which is only correct if the folder moved too. See `recycle.ts`.
   *
   * Returns the id it landed at.
   */
  restoreRecycledDocument(recycledId: number, targetId: number): number;
  /** Whether a live document already holds this id — what picks the restore target. */
  isDocumentIdTaken(id: number): boolean;
  /** Removes bin rows for good. Returns how many went. */
  deleteRecycledDocumentsForever(recycledIds: number[]): number;
  /** Empties the bin. Returns how many went. */
  emptyDocumentsRecycleBin(): number;
  /** How many documents the bin holds — the number the confirmations quote. */
  countRecycledDocuments(): number;

  // Extracted text and full-text search (migration 0165)
  /** One attachment's stored text, or undefined when it has never been read. */
  getAttachmentText(attachmentId: number): AttachmentText | undefined;
  /** Every extraction for one document, in attachment order. */
  listAttachmentTextForDocument(documentId: number): AttachmentText[];
  /**
   * Stores one attachment's text, replacing any earlier extraction.
   *
   * An upsert keyed on `attachment_id`, which is the table's primary key: a second
   * extraction of the same file must replace the first, not sit beside it, or the FTS
   * index would hold both and count the document twice.
   */
  putAttachmentText(input: AttachmentTextWriteData): void;
  /** Drops one attachment's cached text. Only a permanent removal calls this. */
  deleteAttachmentText(attachmentId: number): void;
  /**
   * Full-text search over every extraction, best match first.
   *
   * Takes the reader's raw words, not an FTS5 expression — the implementation is
   * responsible for quoting them, because a bare `AND` or a stray `"` typed into a
   * search box must find documents rather than raise a syntax error.
   */
  searchAttachmentText(query: string): AttachmentTextSearchHit[];
  /**
   * Attachments with no current extraction — the work list.
   *
   * Always includes files never read, files read before hashes existed, and files
   * whose bytes have changed since — a re-upload hashes differently, so it becomes
   * work again, which is what "re-OCR only when a new file is uploaded" means.
   *
   * `skipAttemptedScans: true` (what a SCHEDULED pass sets) additionally leaves out a
   * scan OCR has already been run against and could not read. Without it an
   * unattended job re-recognises every unreadable page on every pass, forever, at
   * ~10s a page on the DS223. See migration 0166.
   */
  listUnindexedAttachments(limit: number, skipAttemptedScans?: boolean): DocumentAttachment[];

  // Taxonomy
  listCategories(): DocumentTaxonomyItem[];
  listTags(): DocumentTaxonomyItem[];
  /** Creates it, or returns the existing row — used by inline creation while filing. */
  upsertCategory(name: string, description: string): DocumentTaxonomyItem;
  upsertTag(name: string, description: string): DocumentTaxonomyItem;
  deleteCategory(name: string): void;
  deleteTag(name: string): void;
  /** The icon bytes, or undefined when none was uploaded. Served by a route. */
  getCategoryIcon(name: string): DecodedImage | undefined;
  getTagIcon(name: string): DecodedImage | undefined;
  setCategoryIcon(name: string, image: DecodedImage | null): void;
  setTagIcon(name: string, image: DecodedImage | null): void;

  // Prefill templates (migration 0169). `savePrefillTemplate` covers both create
  // and update — the input's optional id decides which, matching an editor that
  // loads and saves a template whole.
  listPrefillTemplates(): DocumentPrefillTemplate[];
  getPrefillTemplateById(id: number): DocumentPrefillTemplate | undefined;
  /** NOCASE, matching the unique index — what the name-clash check reads. */
  getPrefillTemplateByName(name: string): DocumentPrefillTemplate | undefined;
  savePrefillTemplate(input: DocumentPrefillTemplateWriteData): DocumentPrefillTemplate;
  deletePrefillTemplate(id: number): void;
  setPrefillTemplateEnabled(id: number, isEnabled: boolean): DocumentPrefillTemplate;
}
