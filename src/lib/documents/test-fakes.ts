// Shared in-memory fakes for the Document Library's tests.
//
// Hand-written fakes over mocks, per ARCHITECTURE.md: the tests read as behaviour
// rather than as call-order assertions.
//
// Extracted into its own file when migration 0163 added three more test files
// (content-hash, bulk, recycle) that each need the same repository. Four private
// copies of a fake implementing a growing interface is four places to forget a
// method, and the compiler only catches that at the point of use — so the drift
// shows up as one test file failing to build for a reason that has nothing to do
// with what it tests.
//
// Not a `.test.ts`, so Vitest does not try to collect it as a suite.

import type { DecodedImage } from "@/lib/shared/image-upload";
import type { DocumentFileStore, DocumentRootCheck, FolderListing } from "./file-store";
import type {
  AttachmentWriteData,
  BulkTaxonomyMode,
  DocumentsRepository,
  DocumentWriteData,
} from "./ports";
import type {
  Document,
  DocumentAttachment,
  DocumentSummary,
  DocumentTaxonomyItem,
  DuplicateMatch,
  RecycledDocument,
} from "./types";

const STAMP = "2026-10-30T00:00:00Z";

/** One row of the fake's recycle bin, mirroring the four `doc_recycled_*` tables. */
interface BinnedDocument {
  recycledId: number;
  document: Document;
  attachments: DocumentAttachment[];
  deletedAt: string;
  deletedFolder: string;
}

export class FakeRepository implements DocumentsRepository {
  documents: Document[] = [];
  attachments: DocumentAttachment[] = [];
  categories = new Map<string, string>();
  tags = new Map<string, string>();
  bin: BinnedDocument[] = [];
  categoryIcons = new Map<string, DecodedImage>();
  tagIcons = new Map<string, DecodedImage>();

  private nextDocumentId = 1;
  private nextAttachmentId = 1;
  private nextRecycledId = 1;

  listDocuments(): DocumentSummary[] {
    return this.documents.map((document) => {
      const files = this.attachments.filter((a) => a.documentId === document.id);
      return {
        ...document,
        attachmentCount: files.length,
        totalBytes: files.reduce((sum, a) => sum + a.byteSize, 0),
      };
    });
  }

  getDocumentById(id: number): Document | undefined {
    return this.documents.find((document) => document.id === id);
  }

  createDocument(input: DocumentWriteData): Document {
    const document: Document = {
      id: this.nextDocumentId++,
      ...input,
      createdAt: STAMP,
      updatedAt: STAMP,
    };
    this.documents.push(document);
    return document;
  }

  updateDocument(id: number, input: DocumentWriteData): Document {
    const index = this.documents.findIndex((document) => document.id === id);
    this.documents[index] = { ...this.documents[index], ...input };
    return this.documents[index];
  }

  deleteDocument(id: number): void {
    this.documents = this.documents.filter((document) => document.id !== id);
    this.attachments = this.attachments.filter((a) => a.documentId !== id);
  }

  listAttachments(documentId: number): DocumentAttachment[] {
    return this.attachments.filter((a) => a.documentId === documentId);
  }

  listAttachmentsForDocuments(documentIds: number[]): Map<number, DocumentAttachment[]> {
    const map = new Map<number, DocumentAttachment[]>();
    for (const id of documentIds) {
      const list = this.listAttachments(id);
      if (list.length > 0) map.set(id, list);
    }
    return map;
  }

  getAttachmentById(id: number): DocumentAttachment | undefined {
    return this.attachments.find((a) => a.id === id);
  }

  addAttachment(input: AttachmentWriteData): DocumentAttachment {
    const attachment: DocumentAttachment = {
      id: this.nextAttachmentId++,
      ...input,
      sortOrder: this.listAttachments(input.documentId).length,
      createdAt: STAMP,
    };
    this.attachments.push(attachment);
    return attachment;
  }

  deleteAttachment(id: number): void {
    this.attachments = this.attachments.filter((a) => a.id !== id);
  }

  // -------------------------------------------------------------------------
  // Content hashes (migration 0163)
  // -------------------------------------------------------------------------

  findAttachmentsByHash(contentHash: string): DuplicateMatch[] {
    return this.attachments
      .filter((a) => a.contentHash === contentHash && a.contentHash !== "")
      .map((a) => ({
        attachmentId: a.id,
        documentId: a.documentId,
        documentTitle: this.getDocumentById(a.documentId)?.title ?? "",
        originalName: a.originalName,
      }));
  }

  setAttachmentHash(id: number, contentHash: string): void {
    const attachment = this.attachments.find((a) => a.id === id);
    if (attachment) attachment.contentHash = contentHash;
  }

  listUnhashedAttachments(limit: number): DocumentAttachment[] {
    return this.attachments.filter((a) => a.contentHash === "").slice(0, limit);
  }

  // -------------------------------------------------------------------------
  // Bulk operations (migration 0163)
  // -------------------------------------------------------------------------

  bulkSetTaxonomy(
    ids: number[],
    field: "categories" | "tags",
    mode: BulkTaxonomyMode,
    names: string[],
  ): number {
    let changed = 0;
    for (const id of ids) {
      const document = this.getDocumentById(id);
      if (!document) continue;

      const current = field === "categories" ? document.categories : document.tags;
      let next: string[];
      if (mode === "replace") next = [...names];
      else if (mode === "remove") {
        const drop = new Set(names.map((name) => name.toLowerCase()));
        next = current.filter((name) => !drop.has(name.toLowerCase()));
      } else {
        const have = new Set(current.map((name) => name.toLowerCase()));
        next = [...current, ...names.filter((name) => !have.has(name.toLowerCase()))];
      }

      if (field === "categories") document.categories = next;
      else document.tags = next;
      changed += 1;
    }
    return changed;
  }

  // -------------------------------------------------------------------------
  // Recycle bin (migration 0163)
  // -------------------------------------------------------------------------

  recycleDocuments(ids: number[], deletedFolders: Map<number, string>): number {
    let moved = 0;
    for (const id of ids) {
      const document = this.getDocumentById(id);
      if (!document) continue;

      this.bin.push({
        recycledId: this.nextRecycledId++,
        document: { ...document },
        attachments: this.listAttachments(id).map((a) => ({ ...a })),
        deletedAt: STAMP,
        deletedFolder: deletedFolders.get(id) ?? "",
      });
      this.deleteDocument(id);
      moved += 1;
    }
    return moved;
  }

  listRecycledDocuments(): RecycledDocument[] {
    return [...this.bin].reverse().map((row) => this.toRecycled(row));
  }

  getRecycledDocument(recycledId: number): RecycledDocument | undefined {
    const row = this.bin.find((entry) => entry.recycledId === recycledId);
    return row ? this.toRecycled(row) : undefined;
  }

  private toRecycled(row: BinnedDocument): RecycledDocument {
    return {
      recycledId: row.recycledId,
      id: row.document.id,
      title: row.document.title,
      description: row.document.description,
      categories: [...row.document.categories],
      tags: [...row.document.tags],
      attachmentCount: row.attachments.length,
      totalBytes: row.attachments.reduce((sum, a) => sum + a.byteSize, 0),
      createdBy: row.document.createdBy,
      createdAt: row.document.createdAt,
      updatedAt: row.document.updatedAt,
      deletedAt: row.deletedAt,
      deletedFolder: row.deletedFolder,
    };
  }

  isDocumentIdTaken(id: number): boolean {
    return this.documents.some((document) => document.id === id);
  }

  restoreRecycledDocument(recycledId: number, targetId: number): number {
    const index = this.bin.findIndex((entry) => entry.recycledId === recycledId);
    if (index < 0) return 0;
    const row = this.bin[index];

    const landedId = targetId > 0 ? targetId : this.nextDocumentId++;
    this.documents.push({ ...row.document, id: landedId });

    // The same prefix rewrite the SQL repository does, so a renumbered restore is
    // testable here rather than only against a real database.
    const oldPrefix = `doc_${row.document.id}/`;
    const newPrefix = `doc_${landedId}/`;
    for (const attachment of row.attachments) {
      this.attachments.push({
        ...attachment,
        id: this.nextAttachmentId++,
        documentId: landedId,
        relativePath: attachment.relativePath.startsWith(oldPrefix)
          ? newPrefix + attachment.relativePath.slice(oldPrefix.length)
          : attachment.relativePath,
      });
    }

    this.bin.splice(index, 1);
    return landedId;
  }

  deleteRecycledDocumentsForever(recycledIds: number[]): number {
    const before = this.bin.length;
    this.bin = this.bin.filter((entry) => !recycledIds.includes(entry.recycledId));
    return before - this.bin.length;
  }

  emptyDocumentsRecycleBin(): number {
    const count = this.bin.length;
    this.bin = [];
    return count;
  }

  countRecycledDocuments(): number {
    return this.bin.length;
  }

  // -------------------------------------------------------------------------
  // Taxonomy
  // -------------------------------------------------------------------------

  listCategories(): DocumentTaxonomyItem[] {
    return [...this.categories].map(([name, description]) => this.item(name, description));
  }

  listTags(): DocumentTaxonomyItem[] {
    return [...this.tags].map(([name, description]) => this.item(name, description));
  }

  private item(name: string, description: string): DocumentTaxonomyItem {
    return { name, description, hasIcon: false, createdAt: STAMP, updatedAt: STAMP };
  }

  upsertCategory(name: string, description: string): DocumentTaxonomyItem {
    if (description !== "" || !this.categories.has(name)) this.categories.set(name, description);
    return this.item(name, this.categories.get(name) ?? "");
  }

  upsertTag(name: string, description: string): DocumentTaxonomyItem {
    if (description !== "" || !this.tags.has(name)) this.tags.set(name, description);
    return this.item(name, this.tags.get(name) ?? "");
  }

  deleteCategory(name: string): void {
    this.categories.delete(name);
  }

  deleteTag(name: string): void {
    this.tags.delete(name);
  }

  getCategoryIcon(name: string): DecodedImage | undefined {
    return this.categoryIcons.get(name.toLowerCase());
  }

  getTagIcon(name: string): DecodedImage | undefined {
    return this.tagIcons.get(name.toLowerCase());
  }

  setCategoryIcon(name: string, image: DecodedImage | null): void {
    if (image) this.categoryIcons.set(name.toLowerCase(), image);
    else this.categoryIcons.delete(name.toLowerCase());
  }

  setTagIcon(name: string, image: DecodedImage | null): void {
    if (image) this.tagIcons.set(name.toLowerCase(), image);
    else this.tagIcons.delete(name.toLowerCase());
  }
}

/**
 * An in-memory share. `moved` records what a delete sent to `_deleted/`.
 *
 * `moveToDeleted` returns a stamped destination exactly as the real store does, so a
 * test exercising the bin sees the same two-step (move, then record where) rather than
 * a simplification that would hide the one thing worth testing.
 */
export class FakeFileStore implements DocumentFileStore {
  files = new Map<string, Buffer>();
  moved: string[] = [];
  private stampCounter = 0;

  async write(_root: string, relativePath: string, data: Buffer): Promise<void> {
    this.files.set(relativePath, data);
  }

  async read(_root: string, relativePath: string): Promise<Buffer | undefined> {
    return this.files.get(relativePath);
  }

  async exists(_root: string, relativePath: string): Promise<boolean> {
    return this.files.has(relativePath);
  }

  async moveToDeleted(_root: string, documentId: number): Promise<string> {
    const prefix = `doc_${documentId}/`;
    const keys = [...this.files.keys()].filter((key) => key.startsWith(prefix));
    if (keys.length === 0) return "";

    // A counter rather than a real clock: deterministic, and still distinct per move,
    // which is the property the real stamp exists for.
    const destination = `_deleted/doc_${documentId}_stamp${this.stampCounter++}`;
    for (const key of keys) {
      this.moved.push(key);
      const data = this.files.get(key)!;
      this.files.delete(key);
      this.files.set(`${destination}/${key.slice(prefix.length)}`, data);
    }
    return destination;
  }

  async restoreFromDeleted(
    _root: string,
    fromRelative: string,
    toDocumentId: number,
  ): Promise<void> {
    if (fromRelative.trim() === "") return;
    const prefix = `${fromRelative}/`;
    for (const key of [...this.files.keys()].filter((k) => k.startsWith(prefix))) {
      const data = this.files.get(key)!;
      this.files.delete(key);
      this.files.set(`doc_${toDocumentId}/${key.slice(prefix.length)}`, data);
    }
  }

  async moveFileToDeleted(_root: string, relativePath: string): Promise<void> {
    if (this.files.delete(relativePath)) this.moved.push(relativePath);
  }

  async checkRoot(): Promise<DocumentRootCheck> {
    return { kind: "ok", path: "/share/documents" };
  }

  async listFolders(): Promise<FolderListing> {
    return { path: "/share", parent: null, folders: [] };
  }
}
