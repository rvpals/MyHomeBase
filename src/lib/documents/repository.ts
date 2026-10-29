// The only file in this module that knows SQL.
//
// Returns domain types, never raw driver rows. No DB-level foreign keys, per project
// convention — the cascades below are maintained here, in transactions.
//
// Nothing in this file touches the share. A document's bytes live on the NAS and are
// the file store's business; these tables are the index to them.

import type Database from "better-sqlite3";
import type { DecodedImage } from "@/lib/shared/image-upload";
import type { AttachmentWriteData, DocumentsRepository, DocumentWriteData } from "./ports";
import type { DocumentFilterInput } from "./schema";
import type {
  Document,
  DocumentAttachment,
  DocumentSummary,
  DocumentTaxonomyItem,
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
             (document_id, file_name, original_name, relative_path, mime_type, byte_size, sort_order)
           VALUES (
             @documentId, @fileName, @originalName, @relativePath, @mimeType, @byteSize,
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
}
