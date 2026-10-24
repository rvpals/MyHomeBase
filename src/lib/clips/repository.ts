// The only file in this module that knows SQL.
//
// Returns domain types, never raw driver rows. No DB-level foreign keys, per
// project convention — the cascades below are maintained here, in transactions.

import type Database from "better-sqlite3";
import type { DecodedImage } from "@/lib/shared/image-upload";
import { displayTitle } from "@/lib/shared/encryption";
import type { ClipEncryptionData, ClipsRepository, ClipWriteData } from "./ports";
import type { ClipFilterInput } from "./schema";
import { buildClipExcerpt } from "./sanitize-html";
import type { Clip, ClipImage, ClipLink, ClipLinkModule, ClipSummary, ClipTaxonomyItem } from "./types";

interface ClipRow {
  id: number;
  title: string;
  content_html: string;
  is_encrypted: number;
  title_encrypted: string;
  content_encrypted: string;
  password_hint: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface TaxonomyRow {
  name: string;
  description: string;
  icon_image_mime_type: string | null;
  usage_count: number;
}

interface ImageRow {
  id: number;
  clip_id: number;
  mime_type: string;
  width: number;
  height: number;
  byte_size: number;
  sort_order: number;
}

interface LinkRow {
  id: number;
  clip_id: number;
  target_module: string;
  target_id: number;
  created_at: string;
}

/**
 * Every ordinary taxonomy read names its columns and omits `icon_image`.
 *
 * The same trap migration 0042 records for the journal's taxonomy: a `SELECT *`
 * here would pull every icon's bytes into memory on every page that lists
 * categories or tags. The bytes have exactly one reader, the serving route.
 */
const TAXONOMY_COLUMNS = "name, description, icon_image_mime_type";

/**
 * Likewise for clips: the list never selects the body.
 *
 * `content_html` holds a pasted email and can be hundreds of kilobytes. The list
 * needs an excerpt, so the excerpt is computed from a bounded prefix rather than
 * the whole column — `substr` in SQL, not in TypeScript, so the bytes never leave
 * the database. 2000 characters is far more than the 200-character excerpt needs,
 * with room for the markup that will be stripped out of it.
 */
const EXCERPT_SOURCE_CHARS = 2000;

export class SqliteClipsRepository implements ClipsRepository {
  constructor(private readonly db: Database.Database) {}

  // Clips

  listClips(filter: ClipFilterInput): ClipSummary[] {
    const wheres: string[] = [];
    const params: unknown[] = [];

    if (filter.search !== "") {
      // Sealed clips cannot match a text search — their title and body are
      // ciphertext. That is expected and documented: a sealed clip is findable by
      // its taxonomy, which stays plaintext, exactly as a journal entry is.
      wheres.push("(c.title LIKE ? OR c.content_html LIKE ?)");
      const like = `%${filter.search}%`;
      params.push(like, like);
    }

    // AND semantics: picking two tags means clips carrying BOTH. A HAVING COUNT
    // over the matched rows is what makes that work — an IN alone would be OR.
    if (filter.categories.length > 0) {
      wheres.push(`c.id IN (
        SELECT clip_id FROM clp_clip_categories
        WHERE category_name IN (${filter.categories.map(() => "?").join(", ")}) COLLATE NOCASE
        GROUP BY clip_id HAVING COUNT(DISTINCT category_name) = ?
      )`);
      params.push(...filter.categories, filter.categories.length);
    }

    if (filter.tags.length > 0) {
      wheres.push(`c.id IN (
        SELECT clip_id FROM clp_clip_tags
        WHERE tag_name IN (${filter.tags.map(() => "?").join(", ")}) COLLATE NOCASE
        GROUP BY clip_id HAVING COUNT(DISTINCT tag_name) = ?
      )`);
      params.push(...filter.tags, filter.tags.length);
    }

    if (filter.targetModule !== undefined && filter.targetId !== undefined) {
      wheres.push(
        "c.id IN (SELECT clip_id FROM clp_clip_links WHERE target_module = ? AND target_id = ?)",
      );
      params.push(filter.targetModule, filter.targetId);
    }

    const where = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";

    const rows = this.db
      .prepare(
        `SELECT c.id, c.title, c.is_encrypted, c.created_at, c.updated_at,
                substr(c.content_html, 1, ${EXCERPT_SOURCE_CHARS}) AS excerpt_source,
                (SELECT COUNT(*) FROM clp_clip_images i WHERE i.clip_id = c.id) AS image_count,
                (SELECT COUNT(*) FROM clp_clip_links l WHERE l.clip_id = c.id) AS link_count
         FROM clp_clips c
         ${where}
         ORDER BY c.updated_at DESC, c.id DESC`,
      )
      .all(...params) as Array<{
      id: number;
      title: string;
      is_encrypted: number;
      created_at: string;
      updated_at: string;
      excerpt_source: string;
      image_count: number;
      link_count: number;
    }>;

    if (rows.length === 0) return [];

    const categories = this.taxonomyByClip("clp_clip_categories", "category_name");
    const tags = this.taxonomyByClip("clp_clip_tags", "tag_name");

    return rows.map((row) => ({
      id: row.id,
      title: displayTitle(row.title, row.is_encrypted === 1),
      excerpt: row.is_encrypted === 1 ? "" : buildClipExcerpt(row.excerpt_source),
      isEncrypted: row.is_encrypted === 1,
      categories: categories.get(row.id) ?? [],
      tags: tags.get(row.id) ?? [],
      imageCount: row.image_count,
      linkCount: row.link_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Every clip's categories (or tags) in one query, as a map.
   *
   * Not per-row: a list of 200 clips would otherwise cost 400 extra round trips.
   */
  private taxonomyByClip(table: string, column: string): Map<number, string[]> {
    const rows = this.db
      .prepare(`SELECT clip_id, ${column} AS name FROM ${table} ORDER BY ${column} COLLATE NOCASE`)
      .all() as Array<{ clip_id: number; name: string }>;

    const map = new Map<number, string[]>();
    for (const row of rows) {
      const list = map.get(row.clip_id);
      if (list) list.push(row.name);
      else map.set(row.clip_id, [row.name]);
    }
    return map;
  }

  getClipById(id: number): Clip | undefined {
    const row = this.db.prepare("SELECT * FROM clp_clips WHERE id = ?").get(id) as
      | ClipRow
      | undefined;
    if (!row) return undefined;
    return this.toClip(row);
  }

  private toClip(row: ClipRow): Clip {
    return {
      id: row.id,
      title: row.title,
      contentHtml: row.content_html,
      isEncrypted: row.is_encrypted === 1,
      titleEncrypted: row.title_encrypted,
      contentEncrypted: row.content_encrypted,
      passwordHint: row.password_hint,
      categories: this.namesFor("clp_clip_categories", "category_name", row.id),
      tags: this.namesFor("clp_clip_tags", "tag_name", row.id),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private namesFor(table: string, column: string, clipId: number): string[] {
    return (
      this.db
        .prepare(`SELECT ${column} AS name FROM ${table} WHERE clip_id = ? ORDER BY ${column} COLLATE NOCASE`)
        .all(clipId) as Array<{ name: string }>
    ).map((r) => r.name);
  }

  createClip(input: ClipWriteData): Clip {
    const run = this.db.transaction((data: ClipWriteData) => {
      const result = this.db
        .prepare(
          `INSERT INTO clp_clips (title, content_html, created_by)
           VALUES (@title, @contentHtml, @createdBy)`,
        )
        .run({ title: data.title, contentHtml: data.contentHtml, createdBy: data.createdBy });

      const id = Number(result.lastInsertRowid);
      this.writeTaxonomy(id, data.categories, data.tags);
      return id;
    });

    const id = run(input);
    return this.getClipById(id)!;
  }

  updateClip(id: number, input: ClipWriteData): Clip {
    const run = this.db.transaction((data: ClipWriteData) => {
      this.db
        .prepare(
          `UPDATE clp_clips SET title = @title, content_html = @contentHtml WHERE id = @id`,
        )
        .run({ id, title: data.title, contentHtml: data.contentHtml });

      // Replace rather than diff: the pairings are two columns and a handful of
      // rows, so rewriting them is simpler than reconciling and cannot drift.
      this.db.prepare("DELETE FROM clp_clip_categories WHERE clip_id = ?").run(id);
      this.db.prepare("DELETE FROM clp_clip_tags WHERE clip_id = ?").run(id);
      this.writeTaxonomy(id, data.categories, data.tags);
    });

    run(input);
    return this.getClipById(id)!;
  }

  private writeTaxonomy(clipId: number, categories: string[], tags: string[]): void {
    const addCategory = this.db.prepare(
      "INSERT OR IGNORE INTO clp_clip_categories (clip_id, category_name) VALUES (?, ?)",
    );
    const addTag = this.db.prepare(
      "INSERT OR IGNORE INTO clp_clip_tags (clip_id, tag_name) VALUES (?, ?)",
    );
    for (const name of categories) addCategory.run(clipId, name);
    for (const name of tags) addTag.run(clipId, name);
  }

  deleteClip(id: number): void {
    // One transaction: a clip half-deleted would leave orphaned images serving
    // bytes for a clip that no longer exists.
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM clp_clip_categories WHERE clip_id = ?").run(id);
      this.db.prepare("DELETE FROM clp_clip_tags WHERE clip_id = ?").run(id);
      this.db.prepare("DELETE FROM clp_clip_images WHERE clip_id = ?").run(id);
      this.db.prepare("DELETE FROM clp_clip_links WHERE clip_id = ?").run(id);
      this.db.prepare("DELETE FROM clp_clips WHERE id = ?").run(id);
    })();
  }

  // Encryption

  sealClip(id: number, data: ClipEncryptionData): Clip {
    this.db
      .prepare(
        `UPDATE clp_clips
         SET is_encrypted = 1, title = '', content_html = '',
             title_encrypted = @titleEncrypted, content_encrypted = @contentEncrypted,
             password_hint = @passwordHint
         WHERE id = @id`,
      )
      .run({ id, ...data });
    return this.getClipById(id)!;
  }

  unsealClip(id: number, title: string, contentHtml: string): Clip {
    this.db
      .prepare(
        `UPDATE clp_clips
         SET is_encrypted = 0, title = @title, content_html = @contentHtml,
             title_encrypted = '', content_encrypted = '', password_hint = ''
         WHERE id = @id`,
      )
      .run({ id, title, contentHtml });
    return this.getClipById(id)!;
  }

  // Taxonomy

  listCategories(): ClipTaxonomyItem[] {
    return this.listTaxonomy("clp_categories", "clp_clip_categories", "category_name");
  }

  listTags(): ClipTaxonomyItem[] {
    return this.listTaxonomy("clp_tags", "clp_clip_tags", "tag_name");
  }

  private listTaxonomy(table: string, linkTable: string, column: string): ClipTaxonomyItem[] {
    const rows = this.db
      .prepare(
        `SELECT ${TAXONOMY_COLUMNS.split(", ").map((c) => `t.${c}`).join(", ")},
                (SELECT COUNT(*) FROM ${linkTable} l WHERE l.${column} = t.name COLLATE NOCASE) AS usage_count
         FROM ${table} t
         ORDER BY t.name COLLATE NOCASE`,
      )
      .all() as TaxonomyRow[];

    return rows.map((row) => ({
      name: row.name,
      description: row.description,
      iconMimeType: row.icon_image_mime_type ?? undefined,
      usageCount: row.usage_count,
    }));
  }

  upsertCategory(name: string, description: string): ClipTaxonomyItem {
    return this.upsertTaxonomy("clp_categories", "clp_clip_categories", "category_name", name, description);
  }

  upsertTag(name: string, description: string): ClipTaxonomyItem {
    return this.upsertTaxonomy("clp_tags", "clp_clip_tags", "tag_name", name, description);
  }

  private upsertTaxonomy(
    table: string,
    linkTable: string,
    column: string,
    name: string,
    description: string,
  ): ClipTaxonomyItem {
    // A description is only written when one is supplied, so inline creation while
    // writing a clip ("" for the description) cannot wipe a description the reader
    // typed on the Categories & Tags screen.
    this.db
      .prepare(
        `INSERT INTO ${table} (name, description) VALUES (@name, @description)
         ON CONFLICT(name) DO UPDATE SET
           description = CASE WHEN @description = '' THEN description ELSE @description END`,
      )
      .run({ name, description });

    const row = this.db
      .prepare(
        `SELECT ${TAXONOMY_COLUMNS},
                (SELECT COUNT(*) FROM ${linkTable} l WHERE l.${column} = @name COLLATE NOCASE) AS usage_count
         FROM ${table} WHERE name = @name COLLATE NOCASE`,
      )
      .get({ name }) as TaxonomyRow;

    return {
      name: row.name,
      description: row.description,
      iconMimeType: row.icon_image_mime_type ?? undefined,
      usageCount: row.usage_count,
    };
  }

  deleteCategory(name: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM clp_clip_categories WHERE category_name = ? COLLATE NOCASE").run(name);
      this.db.prepare("DELETE FROM clp_categories WHERE name = ? COLLATE NOCASE").run(name);
    })();
  }

  deleteTag(name: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM clp_clip_tags WHERE tag_name = ? COLLATE NOCASE").run(name);
      this.db.prepare("DELETE FROM clp_tags WHERE name = ? COLLATE NOCASE").run(name);
    })();
  }

  getCategoryIcon(name: string): DecodedImage | undefined {
    return this.readIcon("clp_categories", name);
  }

  getTagIcon(name: string): DecodedImage | undefined {
    return this.readIcon("clp_tags", name);
  }

  private readIcon(table: string, name: string): DecodedImage | undefined {
    const row = this.db
      .prepare(`SELECT icon_image, icon_image_mime_type FROM ${table} WHERE name = ? COLLATE NOCASE`)
      .get(name) as { icon_image: Buffer | null; icon_image_mime_type: string | null } | undefined;

    if (!row?.icon_image || !row.icon_image_mime_type) return undefined;
    return { data: row.icon_image, mimeType: row.icon_image_mime_type };
  }

  setCategoryIcon(name: string, image: DecodedImage | null): void {
    this.writeIcon("clp_categories", name, image);
  }

  setTagIcon(name: string, image: DecodedImage | null): void {
    this.writeIcon("clp_tags", name, image);
  }

  private writeIcon(table: string, name: string, image: DecodedImage | null): void {
    this.db
      .prepare(
        `UPDATE ${table} SET icon_image = @data, icon_image_mime_type = @mimeType
         WHERE name = @name COLLATE NOCASE`,
      )
      .run({ name, data: image?.data ?? null, mimeType: image?.mimeType ?? null });
  }

  // Images

  listClipImages(clipId: number): ClipImage[] {
    const rows = this.db
      .prepare(
        `SELECT id, clip_id, mime_type, width, height, byte_size, sort_order
         FROM clp_clip_images WHERE clip_id = ? ORDER BY sort_order, id`,
      )
      .all(clipId) as ImageRow[];

    return rows.map((row) => ({
      id: row.id,
      clipId: row.clip_id,
      mimeType: row.mime_type,
      width: row.width,
      height: row.height,
      byteSize: row.byte_size,
      sortOrder: row.sort_order,
    }));
  }

  getClipImage(id: number): DecodedImage | undefined {
    const row = this.db
      .prepare("SELECT image_data, mime_type FROM clp_clip_images WHERE id = ?")
      .get(id) as { image_data: Buffer; mime_type: string } | undefined;
    if (!row) return undefined;
    return { data: row.image_data, mimeType: row.mime_type };
  }

  addClipImage(clipId: number, image: DecodedImage, width: number, height: number): ClipImage {
    const next = this.db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM clp_clip_images WHERE clip_id = ?")
      .get(clipId) as { next: number };

    const result = this.db
      .prepare(
        `INSERT INTO clp_clip_images (clip_id, image_data, mime_type, width, height, byte_size, sort_order)
         VALUES (@clipId, @data, @mimeType, @width, @height, @byteSize, @sortOrder)`,
      )
      .run({
        clipId,
        data: image.data,
        mimeType: image.mimeType,
        width,
        height,
        byteSize: image.data.length,
        sortOrder: next.next,
      });

    return {
      id: Number(result.lastInsertRowid),
      clipId,
      mimeType: image.mimeType,
      width,
      height,
      byteSize: image.data.length,
      sortOrder: next.next,
    };
  }

  deleteClipImage(id: number): void {
    this.db.prepare("DELETE FROM clp_clip_images WHERE id = ?").run(id);
  }

  // Links

  listLinksForClip(clipId: number): ClipLink[] {
    const rows = this.db
      .prepare("SELECT * FROM clp_clip_links WHERE clip_id = ? ORDER BY created_at, id")
      .all(clipId) as LinkRow[];
    return rows.map(toLink);
  }

  listLinksForTarget(targetModule: ClipLinkModule, targetId: number): ClipLink[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM clp_clip_links WHERE target_module = ? AND target_id = ? ORDER BY created_at, id",
      )
      .all(targetModule, targetId) as LinkRow[];
    return rows.map(toLink);
  }

  countLinksForTargets(targetModule: ClipLinkModule, targetIds: number[]): Map<number, number> {
    if (targetIds.length === 0) return new Map();

    const rows = this.db
      .prepare(
        `SELECT target_id, COUNT(*) AS count FROM clp_clip_links
         WHERE target_module = ? AND target_id IN (${targetIds.map(() => "?").join(", ")})
         GROUP BY target_id`,
      )
      .all(targetModule, ...targetIds) as Array<{ target_id: number; count: number }>;

    return new Map(rows.map((row) => [row.target_id, row.count]));
  }

  createLink(clipId: number, targetModule: ClipLinkModule, targetId: number): ClipLink {
    // Idempotent: the unique index makes a repeat link a no-op rather than an
    // error, so pressing "attach" twice cannot fail in the reader's face.
    this.db
      .prepare(
        `INSERT OR IGNORE INTO clp_clip_links (clip_id, target_module, target_id)
         VALUES (?, ?, ?)`,
      )
      .run(clipId, targetModule, targetId);

    const row = this.db
      .prepare(
        "SELECT * FROM clp_clip_links WHERE clip_id = ? AND target_module = ? AND target_id = ?",
      )
      .get(clipId, targetModule, targetId) as LinkRow;

    return toLink(row);
  }

  deleteLink(linkId: number): void {
    this.db.prepare("DELETE FROM clp_clip_links WHERE id = ?").run(linkId);
  }
}

function toLink(row: LinkRow): ClipLink {
  return {
    id: row.id,
    clipId: row.clip_id,
    targetModule: row.target_module as ClipLinkModule,
    targetId: row.target_id,
    createdAt: row.created_at,
  };
}
