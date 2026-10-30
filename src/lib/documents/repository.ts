// The only file in this module that knows SQL.
//
// Returns domain types, never raw driver rows. No DB-level foreign keys, per project
// convention — the cascades below are maintained here, in transactions.
//
// Nothing in this file touches the share. A document's bytes live on the NAS and are
// the file store's business; these tables are the index to them.

import type Database from "better-sqlite3";
import type { DecodedImage } from "@/lib/shared/image-upload";
import type {
  AttachmentWriteData,
  BulkTaxonomyMode,
  DocumentsRepository,
  DocumentWriteData,
} from "./ports";
import type { DocumentFilterInput } from "./schema";
import type {
  Document,
  DocumentAttachment,
  DocumentSummary,
  DocumentTaxonomyItem,
  DuplicateMatch,
  RecycledDocument,
} from "./types";

interface DocumentRow {
  id: number;
  title: string;
  description: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface SummaryRow extends DocumentRow {
  attachment_count: number;
  total_bytes: number | null;
}

interface AttachmentRow {
  id: number;
  document_id: number;
  file_name: string;
  original_name: string;
  relative_path: string;
  mime_type: string;
  byte_size: number;
  content_hash: string;
  sort_order: number;
  created_at: string;
}

interface TaxonomyRow {
  name: string;
  description: string;
  icon_image_mime_type: string | null;
  created_at: string;
  updated_at: string;
}

/** One row of the recycle bin's list query (migration 0163). */
interface RecycledRow {
  recycled_id: number;
  document_id: number;
  title: string;
  description: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string;
  deleted_folder: string;
  attachment_count: number;
  total_bytes: number | null;
}

/**
 * Shared by the bin's list and its single-row read, so the two cannot disagree on
 * which id is the handle — `recycledId` is, and `id` is the id the document had.
 */
function toRecycledDocument(
  row: RecycledRow,
  categories: Map<number, string[]>,
  tags: Map<number, string[]>,
): RecycledDocument {
  return {
    recycledId: row.recycled_id,
    id: row.document_id,
    title: row.title,
    description: row.description,
    categories: categories.get(row.recycled_id) ?? [],
    tags: tags.get(row.recycled_id) ?? [],
    attachmentCount: row.attachment_count,
    // COALESCE in SQL already makes this 0 over no rows; the ?? is for the driver
    // returning NULL on an empty aggregate in a path the query did not cover.
    totalBytes: row.total_bytes ?? 0,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    deletedFolder: row.deleted_folder,
  };
}

/**
 * Every ordinary taxonomy read names its columns and omits `icon_image`.
 *
 * The same trap migration 0042 records for the journal's taxonomy: a `SELECT *` here
 * would pull every icon's bytes into memory on every page that lists categories or
 * tags. The bytes have exactly one reader, the serving route.
 */
const TAXONOMY_COLUMNS = "name, description, icon_image_mime_type, created_at, updated_at";

function toDocument(row: DocumentRow, categories: string[], tags: string[]): Document {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    categories,
    tags,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toAttachment(row: AttachmentRow): DocumentAttachment {
  return {
    id: row.id,
    documentId: row.document_id,
    fileName: row.file_name,
    originalName: row.original_name,
    relativePath: row.relative_path,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    // '' for every row predating migration 0163, which did not backfill.
    contentHash: row.content_hash ?? "",
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

function toTaxonomyItem(row: TaxonomyRow): DocumentTaxonomyItem {
  return {
    name: row.name,
    description: row.description,
    hasIcon: row.icon_image_mime_type !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteDocumentsRepository implements DocumentsRepository {
  constructor(private readonly db: Database.Database) {}

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------

  listDocuments(filter: DocumentFilterInput): DocumentSummary[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (filter.search !== "") {
      // LIKE with an escaped pattern: `%` and `_` typed into the search box are
      // literal characters to a reader, not wildcards.
      where.push("(d.title LIKE @search ESCAPE '\\' OR d.description LIKE @search ESCAPE '\\')");
      params.search = `%${filter.search.replace(/[\\%_]/g, "\\$&")}%`;
    }

    // Each taxonomy filter is an EXISTS per name, so several names mean "has all of
    // them" rather than "has any". Matching the Journal: narrowing with a second tag
    // should return fewer rows, not more.
    filter.categories.forEach((name, index) => {
      const key = `cat${index}`;
      where.push(
        `EXISTS (SELECT 1 FROM doc_document_categories dc
                 WHERE dc.document_id = d.id AND dc.category_name = @${key} COLLATE NOCASE)`,
      );
      params[key] = name;
    });

    filter.tags.forEach((name, index) => {
      const key = `tag${index}`;
      where.push(
        `EXISTS (SELECT 1 FROM doc_document_tags dt
                 WHERE dt.document_id = d.id AND dt.tag_name = @${key} COLLATE NOCASE)`,
      );
      params[key] = name;
    });

    const rows = this.db
      .prepare(
        `SELECT d.id, d.title, d.description, d.created_by, d.created_at, d.updated_at,
                COUNT(a.id) AS attachment_count,
                SUM(a.byte_size) AS total_bytes
           FROM doc_documents d
           LEFT JOIN doc_attachments a ON a.document_id = d.id
          ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
          GROUP BY d.id
          ORDER BY d.updated_at DESC, d.id DESC`,
      )
      .all(params) as SummaryRow[];

    if (rows.length === 0) return [];

    // The taxonomy for the whole page in two queries rather than two per row.
    const ids = rows.map((row) => row.id);
    const categories = this.taxonomyFor("doc_document_categories", "category_name", ids);
    const tags = this.taxonomyFor("doc_document_tags", "tag_name", ids);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      categories: categories.get(row.id) ?? [],
      tags: tags.get(row.id) ?? [],
      attachmentCount: row.attachment_count,
      // SUM over no rows is NULL, which would reach a view as `null` and render as
      // "null bytes". A document with no attachments is 0.
      totalBytes: row.total_bytes ?? 0,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /** One query per pairing table for a whole page of documents, keyed by document id. */
  private taxonomyFor(
    table: string,
    column: string,
    documentIds: number[],
  ): Map<number, string[]> {
    const placeholders = documentIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT document_id, ${column} AS name FROM ${table}
          WHERE document_id IN (${placeholders})
          ORDER BY ${column} COLLATE NOCASE`,
      )
      .all(...documentIds) as { document_id: number; name: string }[];

    const byDocument = new Map<number, string[]>();
    for (const row of rows) {
      const list = byDocument.get(row.document_id);
      if (list) list.push(row.name);
      else byDocument.set(row.document_id, [row.name]);
    }
    return byDocument;
  }

  getDocumentById(id: number): Document | undefined {
    const row = this.db.prepare(`SELECT * FROM doc_documents WHERE id = ?`).get(id) as
      | DocumentRow
      | undefined;
    if (!row) return undefined;
    return toDocument(row, this.namesFor("doc_document_categories", "category_name", id), this.namesFor("doc_document_tags", "tag_name", id));
  }

  private namesFor(table: string, column: string, documentId: number): string[] {
    return (
      this.db
        .prepare(
          `SELECT ${column} AS name FROM ${table}
            WHERE document_id = ? ORDER BY ${column} COLLATE NOCASE`,
        )
        .all(documentId) as { name: string }[]
    ).map((row) => row.name);
  }

  createDocument(input: DocumentWriteData): Document {
    const run = this.db.transaction((data: DocumentWriteData) => {
      const result = this.db
        .prepare(
          `INSERT INTO doc_documents (title, description, created_by)
           VALUES (@title, @description, @createdBy)`,
        )
        .run({
          title: data.title,
          description: data.description,
          createdBy: data.createdBy,
        });
      const id = Number(result.lastInsertRowid);
      this.writeTaxonomy(id, data.categories, data.tags);
      return id;
    });

    const id = run(input);
    // Non-null: the row was just written inside the transaction above.
    return this.getDocumentById(id)!;
  }

  updateDocument(id: number, input: DocumentWriteData): Document {
    const run = this.db.transaction((data: DocumentWriteData) => {
      this.db
        .prepare(`UPDATE doc_documents SET title = @title, description = @description WHERE id = @id`)
        .run({ id, title: data.title, description: data.description });
      // A full replace, matching the use-case's contract: clear then rewrite, so a
      // removed chip actually goes.
      this.db.prepare(`DELETE FROM doc_document_categories WHERE document_id = ?`).run(id);
      this.db.prepare(`DELETE FROM doc_document_tags WHERE document_id = ?`).run(id);
      this.writeTaxonomy(id, data.categories, data.tags);
    });

    run(input);
    return this.getDocumentById(id)!;
  }

  private writeTaxonomy(documentId: number, categories: string[], tags: string[]): void {
    const category = this.db.prepare(
      `INSERT OR IGNORE INTO doc_document_categories (document_id, category_name) VALUES (?, ?)`,
    );
    for (const name of categories) category.run(documentId, name);

    const tag = this.db.prepare(
      `INSERT OR IGNORE INTO doc_document_tags (document_id, tag_name) VALUES (?, ?)`,
    );
    for (const name of tags) tag.run(documentId, name);
  }

  deleteDocument(id: number): void {
    // One transaction: a half-deleted document would leave attachment rows pointing at
    // files nothing can reach, and pairings under a document that no longer exists.
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM doc_document_categories WHERE document_id = ?`).run(id);
      this.db.prepare(`DELETE FROM doc_document_tags WHERE document_id = ?`).run(id);
      this.db.prepare(`DELETE FROM doc_attachments WHERE document_id = ?`).run(id);
      this.db.prepare(`DELETE FROM doc_documents WHERE id = ?`).run(id);
    })();
  }

  // -------------------------------------------------------------------------
  // Attachments
  // -------------------------------------------------------------------------

  listAttachments(documentId: number): DocumentAttachment[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM doc_attachments WHERE document_id = ? ORDER BY sort_order, id`,
      )
      .all(documentId) as AttachmentRow[];
    return rows.map(toAttachment);
  }

  listAttachmentsForDocuments(documentIds: number[]): Map<number, DocumentAttachment[]> {
    if (documentIds.length === 0) return new Map();
    const placeholders = documentIds.map(() => "?").join(", ");
    const rows = this.db
      .prepare(
        `SELECT * FROM doc_attachments
          WHERE document_id IN (${placeholders})
          ORDER BY document_id, sort_order, id`,
      )
      .all(...documentIds) as AttachmentRow[];

    const byDocument = new Map<number, DocumentAttachment[]>();
    for (const row of rows) {
      const attachment = toAttachment(row);
      const list = byDocument.get(row.document_id);
      if (list) list.push(attachment);
      else byDocument.set(row.document_id, [attachment]);
    }
    return byDocument;
  }

  getAttachmentById(id: number): DocumentAttachment | undefined {
    const row = this.db.prepare(`SELECT * FROM doc_attachments WHERE id = ?`).get(id) as
      | AttachmentRow
      | undefined;
    return row ? toAttachment(row) : undefined;
  }

  addAttachment(input: AttachmentWriteData): DocumentAttachment {
    const run = this.db.transaction((data: AttachmentWriteData) => {
      // Appended to the end of the document's list. COALESCE because MAX over no rows
      // is NULL, which would make the first attachment's sort_order NULL rather than 0.
      const result = this.db
        .prepare(
          `INSERT INTO doc_attachments
             (document_id, file_name, original_name, relative_path, mime_type, byte_size,
              content_hash, sort_order)
           VALUES (
             @documentId, @fileName, @originalName, @relativePath, @mimeType, @byteSize,
             @contentHash,
             (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM doc_attachments WHERE document_id = @documentId)
           )`,
        )
        .run(data);
      // Touch the document so the list's "most recently touched first" ordering
      // reflects an added file — the trigger only fires on an UPDATE of the document.
      this.db.prepare(`UPDATE doc_documents SET updated_at = datetime('now') WHERE id = ?`).run(data.documentId);
      return Number(result.lastInsertRowid);
    });

    return this.getAttachmentById(run(input))!;
  }

  deleteAttachment(id: number): void {
    this.db.transaction(() => {
      const row = this.db
        .prepare(`SELECT document_id FROM doc_attachments WHERE id = ?`)
        .get(id) as { document_id: number } | undefined;
      this.db.prepare(`DELETE FROM doc_attachments WHERE id = ?`).run(id);
      if (row) {
        this.db
          .prepare(`UPDATE doc_documents SET updated_at = datetime('now') WHERE id = ?`)
          .run(row.document_id);
      }
    })();
  }

  // -------------------------------------------------------------------------
  // Taxonomy
  // -------------------------------------------------------------------------

  listCategories(): DocumentTaxonomyItem[] {
    return (
      this.db
        .prepare(`SELECT ${TAXONOMY_COLUMNS} FROM doc_categories ORDER BY name COLLATE NOCASE`)
        .all() as TaxonomyRow[]
    ).map(toTaxonomyItem);
  }

  listTags(): DocumentTaxonomyItem[] {
    return (
      this.db
        .prepare(`SELECT ${TAXONOMY_COLUMNS} FROM doc_tags ORDER BY name COLLATE NOCASE`)
        .all() as TaxonomyRow[]
    ).map(toTaxonomyItem);
  }

  upsertCategory(name: string, description: string): DocumentTaxonomyItem {
    return this.upsertTaxonomy("doc_categories", name, description);
  }

  upsertTag(name: string, description: string): DocumentTaxonomyItem {
    return this.upsertTaxonomy("doc_tags", name, description);
  }

  private upsertTaxonomy(table: string, name: string, description: string): DocumentTaxonomyItem {
    // A description is only written when one is supplied, so inline creation while
    // filing a document ("" for the description) cannot wipe a description the reader
    // typed on the Categories & Tags screen. Same rule as Clips.
    this.db
      .prepare(
        `INSERT INTO ${table} (name, description) VALUES (@name, @description)
         ON CONFLICT(name) DO UPDATE SET
           description = CASE WHEN @description = '' THEN description ELSE @description END`,
      )
      .run({ name, description });

    const row = this.db
      .prepare(`SELECT ${TAXONOMY_COLUMNS} FROM ${table} WHERE name = ? COLLATE NOCASE`)
      .get(name) as TaxonomyRow;
    return toTaxonomyItem(row);
  }

  deleteCategory(name: string): void {
    this.db.transaction(() => {
      this.db
        .prepare(`DELETE FROM doc_document_categories WHERE category_name = ? COLLATE NOCASE`)
        .run(name);
      this.db.prepare(`DELETE FROM doc_categories WHERE name = ? COLLATE NOCASE`).run(name);
    })();
  }

  deleteTag(name: string): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM doc_document_tags WHERE tag_name = ? COLLATE NOCASE`).run(name);
      this.db.prepare(`DELETE FROM doc_tags WHERE name = ? COLLATE NOCASE`).run(name);
    })();
  }

  getCategoryIcon(name: string): DecodedImage | undefined {
    return this.getIcon("doc_categories", name);
  }

  getTagIcon(name: string): DecodedImage | undefined {
    return this.getIcon("doc_tags", name);
  }

  private getIcon(table: string, name: string): DecodedImage | undefined {
    const row = this.db
      .prepare(
        `SELECT icon_image, icon_image_mime_type FROM ${table} WHERE name = ? COLLATE NOCASE`,
      )
      .get(name) as { icon_image: Buffer | null; icon_image_mime_type: string | null } | undefined;
    if (!row?.icon_image || !row.icon_image_mime_type) return undefined;
    return { data: row.icon_image, mimeType: row.icon_image_mime_type };
  }

  setCategoryIcon(name: string, image: DecodedImage | null): void {
    this.setIcon("doc_categories", name, image);
  }

  setTagIcon(name: string, image: DecodedImage | null): void {
    this.setIcon("doc_tags", name, image);
  }

  private setIcon(table: string, name: string, image: DecodedImage | null): void {
    this.db
      .prepare(
        `UPDATE ${table} SET icon_image = @data, icon_image_mime_type = @mimeType
          WHERE name = @name COLLATE NOCASE`,
      )
      .run({ name, data: image?.data ?? null, mimeType: image?.mimeType ?? null });
  }

  // -------------------------------------------------------------------------
  // Content hashes (migration 0163)
  // -------------------------------------------------------------------------

  findAttachmentsByHash(contentHash: string): DuplicateMatch[] {
    // The partial index `idx_doc_attachments_hash` covers exactly this predicate.
    // The `!= ''` is not redundant with the caller's guard: it is what keeps the
    // query on the index, since the index excludes blank rows.
    const rows = this.db
      .prepare(
        `SELECT a.id, a.document_id, a.original_name, d.title
           FROM doc_attachments a
           JOIN doc_documents d ON d.id = a.document_id
          WHERE a.content_hash = ? AND a.content_hash != ''
          ORDER BY d.title COLLATE NOCASE, a.original_name COLLATE NOCASE`,
      )
      .all(contentHash) as {
      id: number;
      document_id: number;
      original_name: string;
      title: string;
    }[];

    return rows.map((row) => ({
      attachmentId: row.id,
      documentId: row.document_id,
      documentTitle: row.title,
      originalName: row.original_name,
    }));
  }

  setAttachmentHash(id: number, contentHash: string): void {
    this.db
      .prepare(`UPDATE doc_attachments SET content_hash = ? WHERE id = ?`)
      .run(contentHash, id);
  }

  listUnhashedAttachments(limit: number): DocumentAttachment[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM doc_attachments WHERE content_hash = '' ORDER BY id LIMIT ?`,
      )
      .all(Math.max(1, Math.floor(limit))) as AttachmentRow[];
    return rows.map(toAttachment);
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
    if (ids.length === 0) return 0;

    const table = field === "categories" ? "doc_document_categories" : "doc_document_tags";
    const column = field === "categories" ? "category_name" : "tag_name";

    // INSERT OR IGNORE against the pairing table's primary key: adding a category a
    // document already holds is an ordinary thing to do in a bulk edit and must not
    // fail the transaction for the other eleven rows.
    const add = this.db.prepare(
      `INSERT OR IGNORE INTO ${table} (document_id, ${column}) VALUES (?, ?)`,
    );
    const remove = this.db.prepare(
      `DELETE FROM ${table} WHERE document_id = ? AND ${column} = ? COLLATE NOCASE`,
    );
    const clear = this.db.prepare(`DELETE FROM ${table} WHERE document_id = ?`);
    const exists = this.db.prepare(`SELECT 1 FROM doc_documents WHERE id = ?`);
    const touch = this.db.prepare(
      `UPDATE doc_documents SET updated_at = datetime('now') WHERE id = ?`,
    );

    let changed = 0;
    this.db.transaction(() => {
      for (const id of ids) {
        // An id that has gone since the selection was made is skipped, not an error:
        // two people filing at once is ordinary, and failing the whole batch over one
        // stale tick would be the wrong trade.
        if (!exists.get(id)) continue;

        if (mode === "replace") clear.run(id);
        for (const name of names) {
          if (mode === "remove") remove.run(id, name);
          else add.run(id, name);
        }

        // Touched so the list's "most recently touched first" ordering reflects the
        // edit, the same way `addAttachment` does. Without it a bulk retag would be
        // invisible in the list it was performed from.
        touch.run(id);
        changed += 1;
      }
    })();

    return changed;
  }

  // -------------------------------------------------------------------------
  // Recycle bin (migration 0163)
  // -------------------------------------------------------------------------

  recycleDocuments(ids: number[], deletedFolders: Map<number, string>): number {
    if (ids.length === 0) return 0;

    const insertParent = this.db.prepare(
      `INSERT INTO doc_recycled_documents
         (document_id, title, description, created_by, created_at, updated_at, deleted_folder)
       SELECT id, title, description, created_by, created_at, updated_at, @deletedFolder
         FROM doc_documents WHERE id = @id`,
    );

    // Each child is re-keyed onto the new parent id, which is why documents are moved
    // one at a time rather than in one set-based INSERT..SELECT: last_insert_rowid()
    // is only unambiguous for a single-row insert. Same reasoning as `recycleClips`.
    const copyAttachments = this.db.prepare(
      `INSERT INTO doc_recycled_attachments
         (recycled_document_id, file_name, original_name, relative_path, mime_type,
          byte_size, content_hash, sort_order, created_at)
       SELECT ?, file_name, original_name, relative_path, mime_type,
              byte_size, content_hash, sort_order, created_at
         FROM doc_attachments WHERE document_id = ? ORDER BY sort_order, id`,
    );
    const copyCategories = this.db.prepare(
      `INSERT INTO doc_recycled_document_categories (recycled_document_id, category_name)
       SELECT ?, category_name FROM doc_document_categories WHERE document_id = ?`,
    );
    const copyTags = this.db.prepare(
      `INSERT INTO doc_recycled_document_tags (recycled_document_id, tag_name)
       SELECT ?, tag_name FROM doc_document_tags WHERE document_id = ?`,
    );

    let moved = 0;
    this.db.transaction(() => {
      for (const id of ids) {
        // An id that has already gone copies no row here, so the whole move for it is
        // skipped and the count the caller reports stays honest.
        const result = insertParent.run({ id, deletedFolder: deletedFolders.get(id) ?? "" });
        if (result.changes === 0) continue;

        const recycledId = Number(result.lastInsertRowid);
        copyAttachments.run(recycledId, id);
        copyCategories.run(recycledId, id);
        copyTags.run(recycledId, id);

        // The same cascade `deleteDocument` runs, in the same order, so the two paths
        // cannot drift on which tables a document owns.
        this.db.prepare(`DELETE FROM doc_document_categories WHERE document_id = ?`).run(id);
        this.db.prepare(`DELETE FROM doc_document_tags WHERE document_id = ?`).run(id);
        this.db.prepare(`DELETE FROM doc_attachments WHERE document_id = ?`).run(id);
        this.db.prepare(`DELETE FROM doc_documents WHERE id = ?`).run(id);
        moved += 1;
      }
    })();

    return moved;
  }

  listRecycledDocuments(): RecycledDocument[] {
    const rows = this.db
      .prepare(
        `SELECT r.id AS recycled_id, r.document_id, r.title, r.description,
                r.created_by, r.created_at, r.updated_at, r.deleted_at, r.deleted_folder,
                (SELECT COUNT(*) FROM doc_recycled_attachments a
                  WHERE a.recycled_document_id = r.id) AS attachment_count,
                (SELECT COALESCE(SUM(byte_size), 0) FROM doc_recycled_attachments a
                  WHERE a.recycled_document_id = r.id) AS total_bytes
           FROM doc_recycled_documents r
          ORDER BY r.deleted_at DESC, r.id DESC`,
      )
      .all() as RecycledRow[];

    if (rows.length === 0) return [];

    const categories = this.recycledNames("doc_recycled_document_categories", "category_name");
    const tags = this.recycledNames("doc_recycled_document_tags", "tag_name");

    return rows.map((row) => toRecycledDocument(row, categories, tags));
  }

  getRecycledDocument(recycledId: number): RecycledDocument | undefined {
    const row = this.db
      .prepare(
        `SELECT r.id AS recycled_id, r.document_id, r.title, r.description,
                r.created_by, r.created_at, r.updated_at, r.deleted_at, r.deleted_folder,
                (SELECT COUNT(*) FROM doc_recycled_attachments a
                  WHERE a.recycled_document_id = r.id) AS attachment_count,
                (SELECT COALESCE(SUM(byte_size), 0) FROM doc_recycled_attachments a
                  WHERE a.recycled_document_id = r.id) AS total_bytes
           FROM doc_recycled_documents r WHERE r.id = ?`,
      )
      .get(recycledId) as RecycledRow | undefined;
    if (!row) return undefined;

    return toRecycledDocument(
      row,
      this.recycledNames("doc_recycled_document_categories", "category_name", recycledId),
      this.recycledNames("doc_recycled_document_tags", "tag_name", recycledId),
    );
  }

  /** The bin's categories (or tags), keyed by `recycled_document_id`. */
  private recycledNames(
    table: string,
    column: string,
    recycledId?: number,
  ): Map<number, string[]> {
    const where = recycledId === undefined ? "" : "WHERE recycled_document_id = ?";
    const params = recycledId === undefined ? [] : [recycledId];
    const rows = this.db
      .prepare(
        `SELECT recycled_document_id, ${column} AS name FROM ${table} ${where}
          ORDER BY ${column} COLLATE NOCASE`,
      )
      .all(...params) as { recycled_document_id: number; name: string }[];

    const byId = new Map<number, string[]>();
    for (const row of rows) {
      const list = byId.get(row.recycled_document_id);
      if (list) list.push(row.name);
      else byId.set(row.recycled_document_id, [row.name]);
    }
    return byId;
  }

  isDocumentIdTaken(id: number): boolean {
    return this.db.prepare(`SELECT 1 FROM doc_documents WHERE id = ?`).get(id) !== undefined;
  }

  restoreRecycledDocument(recycledId: number, targetId: number): number {
    // Two inserts, differing only in whether they name `id`. Restoring at the original
    // id is what keeps every attachment path (`doc_17/lease.pdf`) correct without
    // touching a single row; `targetId` of 0 means that id is taken, so SQLite picks
    // one and the caller rewrites the paths to match. See migration 0163.
    const insertAtId = this.db.prepare(
      `INSERT INTO doc_documents (id, title, description, created_by, created_at, updated_at)
       VALUES (@id, @title, @description, @created_by, @created_at, @updated_at)`,
    );
    const insertFresh = this.db.prepare(
      `INSERT INTO doc_documents (title, description, created_by, created_at, updated_at)
       VALUES (@title, @description, @created_by, @created_at, @updated_at)`,
    );

    // INSERT OR IGNORE on both pairing tables, because each carries a primary key on
    // (document_id, name): restoring at the original id, into a row the taxonomy has
    // since been rebuilt around, must not fail the transaction.
    const restoreCategories = this.db.prepare(
      `INSERT OR IGNORE INTO doc_document_categories (document_id, category_name)
       SELECT ?, category_name FROM doc_recycled_document_categories
        WHERE recycled_document_id = ?`,
    );
    const restoreTags = this.db.prepare(
      `INSERT OR IGNORE INTO doc_document_tags (document_id, tag_name)
       SELECT ?, tag_name FROM doc_recycled_document_tags WHERE recycled_document_id = ?`,
    );

    const run = this.db.transaction(() => {
      const row = this.db
        .prepare(`SELECT * FROM doc_recycled_documents WHERE id = ?`)
        .get(recycledId) as
        | {
            id: number;
            document_id: number;
            title: string;
            description: string;
            created_by: number | null;
            created_at: string;
            updated_at: string;
          }
        | undefined;
      if (!row) return 0;

      const params = {
        title: row.title,
        description: row.description,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };

      const landedId =
        targetId > 0
          ? Number(insertAtId.run({ ...params, id: targetId }).lastInsertRowid)
          : Number(insertFresh.run(params).lastInsertRowid);

      restoreCategories.run(landedId, recycledId);
      restoreTags.run(landedId, recycledId);

      // The attachment rows, with their paths re-pointed at the id the document
      // actually landed at. When that is the original id this rewrites each path to
      // the string it already held, which is the cheap and obviously-correct branch;
      // when it is a fresh id it is the whole reason a restore can renumber at all.
      //
      // Only the leading `doc_<old>/` segment is replaced, by length, rather than by a
      // substring search: a file legitimately called `doc_17_copy.pdf` must not have
      // its NAME rewritten because it starts with the same characters as the folder.
      const oldPrefix = `doc_${row.document_id}/`;
      const newPrefix = `doc_${landedId}/`;
      const binned = this.db
        .prepare(
          `SELECT * FROM doc_recycled_attachments WHERE recycled_document_id = ?
            ORDER BY sort_order, id`,
        )
        .all(recycledId) as (AttachmentRow & { recycled_document_id: number })[];

      const insertAttachment = this.db.prepare(
        `INSERT INTO doc_attachments
           (document_id, file_name, original_name, relative_path, mime_type, byte_size,
            content_hash, sort_order, created_at)
         VALUES (@documentId, @fileName, @originalName, @relativePath, @mimeType,
                 @byteSize, @contentHash, @sortOrder, @createdAt)`,
      );
      for (const attachment of binned) {
        insertAttachment.run({
          documentId: landedId,
          fileName: attachment.file_name,
          originalName: attachment.original_name,
          relativePath: attachment.relative_path.startsWith(oldPrefix)
            ? newPrefix + attachment.relative_path.slice(oldPrefix.length)
            : attachment.relative_path,
          mimeType: attachment.mime_type,
          byteSize: attachment.byte_size,
          contentHash: attachment.content_hash ?? "",
          sortOrder: attachment.sort_order,
          createdAt: attachment.created_at,
        });
      }

      // The bin row and its children go in the same transaction as the restore: a
      // document must not exist in both places at once, or the next restore would
      // make a second copy of it.
      this.purgeRecycledRow(recycledId);
      return landedId;
    });

    return run();
  }

  deleteRecycledDocumentsForever(recycledIds: number[]): number {
    if (recycledIds.length === 0) return 0;
    let deleted = 0;
    this.db.transaction(() => {
      for (const recycledId of recycledIds) {
        if (this.purgeRecycledRow(recycledId)) deleted += 1;
      }
    })();
    return deleted;
  }

  emptyDocumentsRecycleBin(): number {
    const ids = (
      this.db.prepare(`SELECT id FROM doc_recycled_documents`).all() as { id: number }[]
    ).map((row) => row.id);
    return this.deleteRecycledDocumentsForever(ids);
  }

  countRecycledDocuments(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM doc_recycled_documents`)
      .get() as { count: number };
    return row.count;
  }

  /**
   * Removes one bin row and its three children.
   *
   * Private, and shared by restore and purge, so there is exactly one list of the
   * bin's tables. A restore that forgot a child table would leave rows behind that the
   * next `emptyDocumentsRecycleBin` would not reach, since that works from the parent ids.
   *
   * **Touches no files.** The bytes stay under `_deleted/` on the share — see
   * `recycle.ts` for why this module never unlinks a user's file.
   */
  private purgeRecycledRow(recycledId: number): boolean {
    this.db
      .prepare(`DELETE FROM doc_recycled_document_categories WHERE recycled_document_id = ?`)
      .run(recycledId);
    this.db
      .prepare(`DELETE FROM doc_recycled_document_tags WHERE recycled_document_id = ?`)
      .run(recycledId);
    this.db
      .prepare(`DELETE FROM doc_recycled_attachments WHERE recycled_document_id = ?`)
      .run(recycledId);
    const result = this.db
      .prepare(`DELETE FROM doc_recycled_documents WHERE id = ?`)
      .run(recycledId);
    return result.changes > 0;
  }
}
