// The Document Library's use-cases: functions that take data and return data.
//
// Every one of these is callable identically from the web app and the CLI — that is
// the litmus test ARCHITECTURE.md sets, and the reason the file store arrives as a
// port rather than being reached for directly.
//
// ## The one ordering rule in this file
//
// Two stores are in play: the database (the index) and the share (the bytes). They
// cannot be written atomically, so every operation here is sequenced so that a failure
// leaves the **recoverable** state rather than the confusing one:
//
// - **Adding** a file writes the bytes FIRST, then the row. A crash between them
//   leaves an orphan file on the share — invisible, harmless, findable. The reverse
//   would leave a row pointing at a file that was never written, which is a broken
//   download link in the reader's face.
// - **Deleting** removes the rows FIRST, then moves the files. A crash between them
//   leaves files under a document that no longer exists — again, harmless and still on
//   disk. The reverse could delete the files of a document the transaction then failed
//   to remove.

import { decodeImageUpload, type ImageUploadInput } from "@/lib/shared/image-upload";
import { buildZip, MAX_ARCHIVE_BYTES, type ZipEntry } from "@/lib/zip";
import {
  buildAttachmentPath,
  mimeTypeFor,
  sanitizeFileName,
  withCollisionSuffix,
} from "./attachment-path";
import type { DocumentFileStore } from "./file-store";
import type { DocumentsRepository } from "./ports";
import {
  attachmentUploadSchema,
  createDocumentSchema,
  deleteDocumentSchema,
  documentFilterSchema,
  documentTaxonomySchema,
  formatBytes,
  removeAttachmentSchema,
  updateDocumentSchema,
  type CreateDocumentInput,
  type DeleteDocumentInput,
  type DocumentFilterInput,
  type RemoveAttachmentInput,
  type UpdateDocumentInput,
} from "./schema";
import type {
  Document,
  DocumentAttachment,
  DocumentSummary,
  DocumentTaxonomyItem,
  DocumentWithAttachments,
} from "./types";

/** The store plus the folder, as every file-touching use-case takes them. */
export interface DocumentFiles {
  store: DocumentFileStore;
  /** `""` when unset — every use-case that needs it refuses with a readable message. */
  root: string;
}

/** The limits in force, resolved from `sys_app_settings` by the caller. */
export interface DocumentLimitsInput {
  maxFileBytes: number;
  maxFilesPerDocument: number;
}

/**
 * De-duplicates a name list case-insensitively, keeping the first spelling seen.
 *
 * The schema already dropped blanks; this is the de-duplication it leaves behind.
 * Case-insensitive because the taxonomy tables are: "Tax" and "tax" are one category,
 * and storing both on a document would render two identical-looking chips.
 */
function normaliseNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function requireRoot(files: DocumentFiles): string {
  if (files.root.trim() === "") {
    throw new Error("No document folder is set. Set one in the module's Configuration.");
  }
  return files.root;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function listDocuments(
  repo: DocumentsRepository,
  filter: Partial<DocumentFilterInput> = {},
): DocumentSummary[] {
  return repo.listDocuments(documentFilterSchema.parse(filter));
}

/**
 * The attachments for a whole page of documents, keyed by document id.
 *
 * One query for the page, not one per row — which is the entire reason
 * `listAttachmentsForDocuments` exists on the port. A list screen that wants to offer
 * "show me the files" per row uses this; a `DocumentSummary` deliberately carries only
 * the count and the total size, because a list of 200 documents should not drag 600
 * attachment rows into every render.
 *
 * Documents with no attachments are absent from the map rather than present with an
 * empty array, so a caller reads `?? []` once instead of distinguishing two kinds of
 * nothing.
 */
export function listAttachmentsFor(
  repo: DocumentsRepository,
  documentIds: number[],
): Map<number, DocumentAttachment[]> {
  if (documentIds.length === 0) return new Map();
  return repo.listAttachmentsForDocuments(documentIds);
}

/** The full record plus its attachments — what an editor and a viewer both need. */
export function getDocument(
  repo: DocumentsRepository,
  id: number,
): DocumentWithAttachments | undefined {
  const document = repo.getDocumentById(id);
  if (!document) return undefined;
  return { document, attachments: repo.listAttachments(id) };
}

/**
 * Files a new document.
 *
 * Categories and tags are **upserted**, so a name typed into the chip picker becomes a
 * real taxonomy row rather than a dangling pairing. That is what makes inline creation
 * work without a trip to the Categories & Tags screen first.
 */
export function createDocument(
  repo: DocumentsRepository,
  input: CreateDocumentInput,
  createdBy: number | null,
): Document {
  const parsed = createDocumentSchema.parse(input);
  const categories = normaliseNames(parsed.categories);
  const tags = normaliseNames(parsed.tags);

  for (const name of categories) repo.upsertCategory(name, "");
  for (const name of tags) repo.upsertTag(name, "");

  return repo.createDocument({
    title: parsed.title,
    description: parsed.description,
    categories,
    tags,
    createdBy,
  });
}

/** A full replace of the document's own fields and taxonomy. Attachments are untouched. */
export function updateDocument(repo: DocumentsRepository, input: UpdateDocumentInput): Document {
  const parsed = updateDocumentSchema.parse(input);
  const existing = repo.getDocumentById(parsed.id);
  if (!existing) throw new Error("That document no longer exists.");

  const categories = normaliseNames(parsed.categories);
  const tags = normaliseNames(parsed.tags);

  for (const name of categories) repo.upsertCategory(name, "");
  for (const name of tags) repo.upsertTag(name, "");

  return repo.updateDocument(parsed.id, {
    title: parsed.title,
    description: parsed.description,
    categories,
    tags,
    // Attribution never changes on an edit: it records who filed the document, not
    // who touched it last. `updated_at` is what answers that.
    createdBy: existing.createdBy,
  });
}

/**
 * Deletes a document, and optionally its files.
 *
 * Rows first, then files — see the ordering note at the top of this file. When
 * `deleteFiles` is false the files are deliberately left where they are: the folder
 * `doc_<id>/` stays on the share, which is what makes "delete the record, keep the
 * paperwork" a real option rather than a promise the app can't keep.
 *
 * Even on `true`, nothing is unlinked: the folder MOVES to `_deleted/`. A delete here
 * is recoverable by hand on the NAS, which was the explicit requirement.
 */
export async function deleteDocument(
  repo: DocumentsRepository,
  files: DocumentFiles,
  input: DeleteDocumentInput,
): Promise<void> {
  const parsed = deleteDocumentSchema.parse(input);
  const existing = repo.getDocumentById(parsed.id);
  if (!existing) throw new Error("That document no longer exists.");

  // Read the attachment list before the rows go — afterwards there is nothing to read.
  const hadAttachments = repo.listAttachments(parsed.id).length > 0;

  repo.deleteDocument(parsed.id);

  if (parsed.deleteFiles && hadAttachments) {
    await files.store.moveToDeleted(requireRoot(files), parsed.id);
  }
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Stores one uploaded file and indexes it.
 *
 * Bytes first, then the row. The collision loop asks the store whether a name is taken
 * and suffixes until it isn't — two scans both called "Scan.pdf" on one document is an
 * ordinary thing to do, so it is resolved rather than refused.
 *
 * The mime type is taken from the **stored extension**, not from what the browser
 * claimed: a client can send any `Content-Type` it likes, and this value is what the
 * serving route will later hand back.
 */
export async function addAttachment(
  repo: DocumentsRepository,
  files: DocumentFiles,
  limits: DocumentLimitsInput,
  input: { documentId: number; fileName: string; data: Buffer },
): Promise<DocumentAttachment> {
  const root = requireRoot(files);

  const parsed = attachmentUploadSchema(limits.maxFileBytes).parse({
    documentId: input.documentId,
    fileName: input.fileName,
    // Derived rather than trusted — see above.
    mimeType: mimeTypeFor(sanitizeFileName(input.fileName)),
    byteSize: input.data.byteLength,
  });

  const document = repo.getDocumentById(parsed.documentId);
  if (!document) throw new Error("That document no longer exists.");

  const existing = repo.listAttachments(parsed.documentId);
  if (existing.length >= limits.maxFilesPerDocument) {
    throw new Error(
      `A document can hold at most ${limits.maxFilesPerDocument} files. Remove one first.`,
    );
  }

  const basePath = buildAttachmentPath(parsed.documentId, input.fileName);
  let relativePath = basePath;
  for (let n = 2; await files.store.exists(root, relativePath); n += 1) {
    relativePath = withCollisionSuffix(basePath, n);
    // A pathological folder shouldn't spin forever; 200 same-named files is not a
    // case worth supporting, and the count limit above will have fired long before.
    if (n > limits.maxFilesPerDocument + 10) {
      throw new Error("Too many files with that name on this document.");
    }
  }

  await files.store.write(root, relativePath, input.data);

  return repo.addAttachment({
    documentId: parsed.documentId,
    fileName: relativePath.slice(relativePath.lastIndexOf("/") + 1),
    originalName: input.fileName,
    relativePath,
    mimeType: parsed.mimeType,
    byteSize: parsed.byteSize,
  });
}

/** One attachment's bytes, for the serving route. `undefined` when the file is gone. */
export async function readAttachment(
  repo: DocumentsRepository,
  files: DocumentFiles,
  attachmentId: number,
): Promise<{ attachment: DocumentAttachment; data: Buffer } | undefined> {
  const attachment = repo.getAttachmentById(attachmentId);
  if (!attachment) return undefined;
  if (files.root.trim() === "") return undefined;

  const data = await files.store.read(files.root, attachment.relativePath);
  // A row whose file was moved or deleted by hand is a normal state here, not an
  // error: the document still lists it, and the route answers 404.
  if (!data) return undefined;
  return { attachment, data };
}

/** Removes one attachment, moving its file aside when asked. Row first, then file. */
export async function removeAttachment(
  repo: DocumentsRepository,
  files: DocumentFiles,
  input: RemoveAttachmentInput,
): Promise<void> {
  const parsed = removeAttachmentSchema.parse(input);
  const attachment = repo.getAttachmentById(parsed.attachmentId);
  if (!attachment) throw new Error("That attachment no longer exists.");

  repo.deleteAttachment(parsed.attachmentId);

  if (parsed.deleteFile) {
    await files.store.moveFileToDeleted(requireRoot(files), attachment.relativePath);
  }
}

/**
 * Every attachment of one document, as a single zip.
 *
 * Built on demand rather than stored — the decision not to keep a `.zip` on the share
 * was deliberate, so that each file stays individually downloadable and an edit is an
 * add or a remove rather than an unpack-and-repack.
 *
 * A file that has gone missing from the share is **skipped, not fatal**: a reader
 * asking for everything should get what is there rather than an error naming one lost
 * file. The caller is told what was skipped so the screen can say so.
 */
export async function buildDocumentArchive(
  repo: DocumentsRepository,
  files: DocumentFiles,
  documentId: number,
): Promise<{ fileName: string; data: Uint8Array; missing: string[] } | undefined> {
  const document = repo.getDocumentById(documentId);
  if (!document) return undefined;

  const root = requireRoot(files);
  const attachments = repo.listAttachments(documentId);
  if (attachments.length === 0) return undefined;

  const entries: ZipEntry[] = [];
  const missing: string[] = [];
  const usedNames = new Set<string>();
  let total = 0;

  for (const attachment of attachments) {
    const data = await files.store.read(root, attachment.relativePath);
    if (!data) {
      missing.push(attachment.originalName);
      continue;
    }
    total += data.byteLength;
    if (total > MAX_ARCHIVE_BYTES) {
      throw new Error(
        `These files come to more than ${formatBytes(MAX_ARCHIVE_BYTES)}, which is too large for one download. Download them individually.`,
      );
    }

    // The name inside the archive is built from the SANITISED name, not from
    // `originalName`. `buildZip` refuses a name containing a backslash or traversing
    // upwards, and `originalName` is whatever the reader's filesystem handed us — so
    // using it raw would let one oddly-named file fail the entire download.
    //
    // It also refuses DUPLICATES outright, and two files on one document legitimately
    // share a name (the stored path disambiguates them with a suffix, the original
    // name does not). So the suffix is reapplied here, per archive.
    let name = sanitizeFileName(attachment.originalName);
    for (let n = 2; usedNames.has(name.toLowerCase()); n += 1) {
      name = withCollisionSuffix(sanitizeFileName(attachment.originalName), n);
    }
    usedNames.add(name.toLowerCase());

    entries.push({ name, data });
  }

  if (entries.length === 0) return undefined;

  return {
    fileName: `${sanitizeFileName(document.title)}.zip`,
    data: buildZip(entries),
    missing,
  };
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

export function listCategories(repo: DocumentsRepository): DocumentTaxonomyItem[] {
  return repo.listCategories();
}

export function listTags(repo: DocumentsRepository): DocumentTaxonomyItem[] {
  return repo.listTags();
}

export function saveCategory(
  repo: DocumentsRepository,
  input: { name: string; description?: string },
): DocumentTaxonomyItem {
  const parsed = documentTaxonomySchema.parse(input);
  return repo.upsertCategory(parsed.name, parsed.description);
}

export function saveTag(
  repo: DocumentsRepository,
  input: { name: string; description?: string },
): DocumentTaxonomyItem {
  const parsed = documentTaxonomySchema.parse(input);
  return repo.upsertTag(parsed.name, parsed.description);
}

/**
 * Deletes a category.
 *
 * The pairings go with it in the repository's transaction — a document simply stops
 * being filed under it. Deleting a category never deletes a document: the taxonomy is
 * a way of finding things, not the thing itself.
 */
export function deleteCategory(repo: DocumentsRepository, name: string): void {
  repo.deleteCategory(name);
}

export function deleteTag(repo: DocumentsRepository, name: string): void {
  repo.deleteTag(name);
}

// ---------------------------------------------------------------------------
// Taxonomy icons
// ---------------------------------------------------------------------------
//
// A small picture per category and tag, so each is recognisable at a glance wherever
// it is listed. The bytes live in the taxonomy row and are served by a dedicated route
// — never inlined into a list payload. Same arrangement as the Journal's and Expense's.

/**
 * The ceiling on one taxonomy icon, on the decoded bytes.
 *
 * The same 128 KB the Journal uses (`MAX_JOURNAL_ICON_BYTES`). This is a 20-40px
 * glyph beside a name, so anything larger is a photograph that was dropped on the
 * wrong control, and refusing it is kinder than storing a megabyte to render it at
 * thumbnail size.
 */
export const MAX_DOCUMENT_ICON_BYTES = 128 * 1024;

/** Stores a category's icon, replacing any existing one. */
export function setCategoryIcon(
  repo: DocumentsRepository,
  name: string,
  input: ImageUploadInput,
): void {
  if (!findTaxonomy(repo.listCategories(), name)) throw new Error(`No category named "${name}".`);
  repo.setCategoryIcon(name, decodeImageUpload(input, MAX_DOCUMENT_ICON_BYTES));
}

/** Removes a category's icon, leaving the category itself untouched. */
export function clearCategoryIcon(repo: DocumentsRepository, name: string): void {
  if (!findTaxonomy(repo.listCategories(), name)) throw new Error(`No category named "${name}".`);
  repo.setCategoryIcon(name, null);
}

export function setTagIcon(
  repo: DocumentsRepository,
  name: string,
  input: ImageUploadInput,
): void {
  if (!findTaxonomy(repo.listTags(), name)) throw new Error(`No tag named "${name}".`);
  repo.setTagIcon(name, decodeImageUpload(input, MAX_DOCUMENT_ICON_BYTES));
}

export function clearTagIcon(repo: DocumentsRepository, name: string): void {
  if (!findTaxonomy(repo.listTags(), name)) throw new Error(`No tag named "${name}".`);
  repo.setTagIcon(name, null);
}

/** Used only by the icon-serving routes — never by anything rendering a list. */
export function getCategoryIcon(repo: DocumentsRepository, name: string) {
  return repo.getCategoryIcon(name);
}

export function getTagIcon(repo: DocumentsRepository, name: string) {
  return repo.getTagIcon(name);
}

/**
 * Case-insensitive lookup in a taxonomy list.
 *
 * The tables are keyed `COLLATE NOCASE`, so "Tax" and "tax" are one row; a
 * case-sensitive existence check here would reject a name the database would then
 * happily have matched.
 */
function findTaxonomy(items: DocumentTaxonomyItem[], name: string) {
  return items.find((item) => item.name.toLowerCase() === name.trim().toLowerCase());
}
