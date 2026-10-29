import type { DecodedImage } from "@/lib/shared/image-upload";
import type { DocumentFilterInput } from "./schema";
import type {
  Document,
  DocumentAttachment,
  DocumentSummary,
  DocumentTaxonomyItem,
} from "./types";

/** What the repository is handed to write a document. Taxonomy arrives already trimmed. */
export interface DocumentWriteData {
  title: string;
  description: string;
  categories: string[];
  tags: string[];
  createdBy: number | null;
}

/** What the repository is handed to index a newly stored file. */
export interface AttachmentWriteData {
  documentId: number;
  fileName: string;
  originalName: string;
  relativePath: string;
  mimeType: string;
  byteSize: number;
}

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
}
