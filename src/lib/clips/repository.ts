// The only file in this module that knows SQL.
//
// Returns domain types, never raw driver rows. No DB-level foreign keys, per
// project convention — the cascades below are maintained here, in transactions.

import type Database from "better-sqlite3";
import type { DecodedImage } from "@/lib/shared/image-upload";
import { displayTitle } from "@/lib/shared/encryption";
import type {
  ClipEncryptionData,
  ClipItemWriteData,
  ClipsRepository,
  ClipWriteData,
} from "./ports";
import { CLIP_CARD_COLORS, type ClipCardColor, type ClipFilterInput } from "./schema";
import { buildClipExcerpt } from "./sanitize-html";
import type {
  Clip,
  ClipImage,
  ClipItem,
  ClipLink,
  ClipLinkModule,
  ClipSummary,
  ClipTaxonomyItem,
  RecycledClip,
} from "./types";

interface ClipRow {
  id: number;
  title: string;
  content_html: string;
  is_encrypted: number;
  title_encrypted: string;
  content_encrypted: string;
  password_hint: string;
  is_pinned: number;
  card_color: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * A row of `clp_recycled_clips` (migration 0161).
 *
 * `ClipRow` plus the bin's two columns, written out rather than extended: the
 * meaning of `id` differs between the two — here it is the bin's own key and
 * `clip_id` is what `ClipRow.id` means — and an `extends` would hide that.
 */
interface RecycledClipRow {
  id: number;
  clip_id: number;
  title: string;
  content_html: string;
  is_encrypted: number;
  title_encrypted: string;
  content_encrypted: string;
  password_hint: string;
  is_pinned: number;
  card_color: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string;
}

interface ItemRow {
  id: number;
  clip_id: number;
  text: string;
  is_done: number;
  done_at: string | null;
  sort_order: number;
  created_at: string;
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
 * the database.
 *
 * The prefix is **not** the excerpt length. It is that length plus room for the
 * markup that will be stripped out of it: 2000 characters of `<td style=…>` can
 * reduce to a few dozen words. The multiplier is deliberately generous because
 * over-reading costs a few kilobytes while under-reading silently truncates the
 * excerpt a reader asked for.
 *
 * `MAX_CLIP_EXCERPT_CHARS` in `settings.ts` is pinned to this ceiling for exactly
 * that reason — read the note there before raising either one.
 */
const EXCERPT_SOURCE_CHARS = 2000;

/**
 * Narrows a stored colour to the palette.
 *
 * The column is plain TEXT, so a row can hold anything — a key from a newer build,
 * or a value hand-edited in the database. Checking here rather than casting means an
 * unrecognised value becomes the default surface at the one boundary where the data
 * enters the app, instead of travelling as a lie about its own type and surfacing as
 * an unstyled card three layers away.
 */
function toCardColor(value: string): ClipCardColor | "" {
  return (CLIP_CARD_COLORS as readonly string[]).includes(value)
    ? (value as ClipCardColor)
    : "";
}

/** Markup allowance: how much raw HTML to read per character of wanted excerpt. */
const EXCERPT_MARKUP_FACTOR = 6;

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

    // Read enough raw markup to yield the wanted excerpt after stripping, but never
    // more than the ceiling — the bounded-prefix property above is the point.
    const sourceChars = Math.min(
      EXCERPT_SOURCE_CHARS,
      Math.max(1, Math.floor(filter.excerptChars * EXCERPT_MARKUP_FACTOR)),
    );

    const rows = this.db
      .prepare(
        `SELECT c.id, c.title, c.is_encrypted, c.is_pinned, c.card_color,
                c.created_at, c.updated_at,
                substr(c.content_html, 1, ${sourceChars}) AS excerpt_source,
                (SELECT COUNT(*) FROM clp_clip_images i WHERE i.clip_id = c.id) AS image_count,
                (SELECT COUNT(*) FROM clp_clip_links l WHERE l.clip_id = c.id) AS link_count
         FROM clp_clips c
         ${where}
         ORDER BY c.is_pinned DESC, c.updated_at DESC, c.id DESC`,
      )
      .all(...params) as Array<{
      id: number;
      title: string;
      is_encrypted: number;
      is_pinned: number;
      card_color: string;
      created_at: string;
      updated_at: string;
      excerpt_source: string;
      image_count: number;
      link_count: number;
    }>;

    if (rows.length === 0) return [];

    const categories = this.taxonomyByClip("clp_clip_categories", "category_name");
    const tags = this.taxonomyByClip("clp_clip_tags", "tag_name");
    // One query for the whole page's checklists — see `listClipItemsForClips`.
    const items = this.listClipItemsForClips(rows.map((row) => row.id));

    return rows.map((row) => ({
      id: row.id,
      title: displayTitle(row.title, row.is_encrypted === 1),
      excerpt:
        row.is_encrypted === 1
          ? ""
          : buildClipExcerpt(row.excerpt_source, filter.excerptChars),
      isEncrypted: row.is_encrypted === 1,
      isPinned: row.is_pinned === 1,
      color: toCardColor(row.card_color),
      categories: categories.get(row.id) ?? [],
      tags: tags.get(row.id) ?? [],
      items: items.get(row.id) ?? [],
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
      isPinned: row.is_pinned === 1,
      color: toCardColor(row.card_color),
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
          `INSERT INTO clp_clips (title, content_html, card_color, created_by)
           VALUES (@title, @contentHtml, @color, @createdBy)`,
        )
        .run({
          title: data.title,
          contentHtml: data.contentHtml,
          color: data.color,
          createdBy: data.createdBy,
        });

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
          `UPDATE clp_clips
              SET title = @title, content_html = @contentHtml, card_color = @color
            WHERE id = @id`,
        )
        .run({ id, title: data.title, contentHtml: data.contentHtml, color: data.color });

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
      this.db.prepare("DELETE FROM clp_clip_items WHERE clip_id = ?").run(id);
      this.db.prepare("DELETE FROM clp_clips WHERE id = ?").run(id);
    })();
  }

  // Recycle bin (migration 0161)
  //
  // Six tables in, six tables out. The column lists below are written out in full
  // rather than built with `SELECT *` on purpose: migration 0089 records what
  // happens to a mirror that drifts from its source — a column missing from the
  // copy is silently dropped on the way back in, and nothing fails until someone
  // restores a clip and finds its colour gone.

  recycleClips(ids: number[]): number {
    if (ids.length === 0) return 0;

    // The encryption columns travel with the clip. Leaving them out would bin the
    // blanked title and body and drop the ciphertext, so a restored clip would be
    // unreadable forever with nothing to say why.
    const insertParent = this.db.prepare(
      `INSERT INTO clp_recycled_clips (
         clip_id, title, content_html, is_encrypted, title_encrypted,
         content_encrypted, password_hint, is_pinned, card_color, created_by,
         created_at, updated_at
       )
       SELECT id, title, content_html, is_encrypted, title_encrypted,
              content_encrypted, password_hint, is_pinned, card_color, created_by,
              created_at, updated_at
       FROM clp_clips WHERE id = ?`,
    );

    // Each child is re-keyed onto the new parent id, which is why clips are moved
    // one at a time rather than in one set-based INSERT..SELECT: last_insert_rowid()
    // is only unambiguous for a single-row insert. Same reasoning as the journal's
    // `recycleEntries`.
    const copyCategories = this.db.prepare(
      `INSERT INTO clp_recycled_clip_categories (recycled_clip_id, category_name)
       SELECT ?, category_name FROM clp_clip_categories WHERE clip_id = ?`,
    );
    const copyTags = this.db.prepare(
      `INSERT INTO clp_recycled_clip_tags (recycled_clip_id, tag_name)
       SELECT ?, tag_name FROM clp_clip_tags WHERE clip_id = ?`,
    );
    // Bytes and all — see migration 0161 for why the alternative (orphaning the
    // rows in clp_clip_images) would leave a deleted clip's screenshots live at
    // /api/clips/images/<id>.
    const copyImages = this.db.prepare(
      `INSERT INTO clp_recycled_clip_images
         (recycled_clip_id, image_data, mime_type, width, height, byte_size, sort_order, created_at)
       SELECT ?, image_data, mime_type, width, height, byte_size, sort_order, created_at
       FROM clp_clip_images WHERE clip_id = ?`,
    );
    const copyItems = this.db.prepare(
      `INSERT INTO clp_recycled_clip_items
         (recycled_clip_id, text, is_done, done_at, sort_order, created_at)
       SELECT ?, text, is_done, done_at, sort_order, created_at
       FROM clp_clip_items WHERE clip_id = ?`,
    );
    const copyLinks = this.db.prepare(
      `INSERT INTO clp_recycled_clip_links
         (recycled_clip_id, target_module, target_id, created_at)
       SELECT ?, target_module, target_id, created_at
       FROM clp_clip_links WHERE clip_id = ?`,
    );

    let moved = 0;
    this.db.transaction(() => {
      for (const id of ids) {
        // An id that has already gone copies no row here, so the whole move for it
        // is skipped and the count the caller reports stays honest.
        const result = insertParent.run(id);
        if (result.changes === 0) continue;

        const recycledId = Number(result.lastInsertRowid);
        copyCategories.run(recycledId, id);
        copyTags.run(recycledId, id);
        copyImages.run(recycledId, id);
        copyItems.run(recycledId, id);
        copyLinks.run(recycledId, id);

        // The same six-table cascade `deleteClip` runs, in the same order, so the
        // two paths cannot drift on which tables a clip owns.
        this.db.prepare("DELETE FROM clp_clip_categories WHERE clip_id = ?").run(id);
        this.db.prepare("DELETE FROM clp_clip_tags WHERE clip_id = ?").run(id);
        this.db.prepare("DELETE FROM clp_clip_images WHERE clip_id = ?").run(id);
        this.db.prepare("DELETE FROM clp_clip_links WHERE clip_id = ?").run(id);
        this.db.prepare("DELETE FROM clp_clip_items WHERE clip_id = ?").run(id);
        this.db.prepare("DELETE FROM clp_clips WHERE id = ?").run(id);
        moved += 1;
      }
    })();

    return moved;
  }

  listRecycledClips(excerptChars: number): RecycledClip[] {
    // The same bounded-prefix read `listClips` does, for the same reason: a binned
    // pasted email is as large as a live one, and the list shows two lines of it.
    const sourceChars = Math.min(
      EXCERPT_SOURCE_CHARS,
      Math.max(1, Math.floor(excerptChars * EXCERPT_MARKUP_FACTOR)),
    );

    const rows = this.db
      .prepare(
        `SELECT r.id AS recycled_id, r.clip_id, r.title, r.is_encrypted, r.is_pinned,
                r.card_color, r.created_at, r.updated_at, r.deleted_at,
                substr(r.content_html, 1, ${sourceChars}) AS excerpt_source,
                (SELECT COUNT(*) FROM clp_recycled_clip_images i
                  WHERE i.recycled_clip_id = r.id) AS image_count,
                (SELECT COUNT(*) FROM clp_recycled_clip_links l
                  WHERE l.recycled_clip_id = r.id) AS link_count
         FROM clp_recycled_clips r
         ORDER BY r.deleted_at DESC, r.id DESC`,
      )
      .all() as Array<{
      recycled_id: number;
      clip_id: number;
      title: string;
      is_encrypted: number;
      is_pinned: number;
      card_color: string;
      created_at: string;
      updated_at: string;
      deleted_at: string;
      excerpt_source: string;
      image_count: number;
      link_count: number;
    }>;

    if (rows.length === 0) return [];

    const recycledIds = rows.map((row) => row.recycled_id);
    const categories = this.recycledTaxonomy("clp_recycled_clip_categories", "category_name");
    const tags = this.recycledTaxonomy("clp_recycled_clip_tags", "tag_name");
    const items = this.recycledItems(recycledIds);

    return rows.map((row) => ({
      recycledId: row.recycled_id,
      // The id it had, and will get back if it is still free. Not the handle for
      // restore or purge — see `RecycledClip`.
      id: row.clip_id,
      title: displayTitle(row.title, row.is_encrypted === 1),
      excerpt: row.is_encrypted === 1 ? "" : buildClipExcerpt(row.excerpt_source, excerptChars),
      isEncrypted: row.is_encrypted === 1,
      isPinned: row.is_pinned === 1,
      color: toCardColor(row.card_color),
      categories: categories.get(row.recycled_id) ?? [],
      tags: tags.get(row.recycled_id) ?? [],
      items: items.get(row.recycled_id) ?? [],
      imageCount: row.image_count,
      linkCount: row.link_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at,
    }));
  }

  /**
   * The bin's categories (or tags) in one query, keyed by `recycled_clip_id`.
   *
   * The mirror of `taxonomyByClip`, and separate from it because the key column
   * differs. Reads the whole bin rather than filtering by id: the bin is small by
   * nature — anything large has been emptied — and the live version makes the same
   * trade for the same reason.
   */
  private recycledTaxonomy(table: string, column: string): Map<number, string[]> {
    const rows = this.db
      .prepare(
        `SELECT recycled_clip_id, ${column} AS name FROM ${table}
         ORDER BY ${column} COLLATE NOCASE`,
      )
      .all() as Array<{ recycled_clip_id: number; name: string }>;

    const map = new Map<number, string[]>();
    for (const row of rows) {
      const list = map.get(row.recycled_clip_id);
      if (list) list.push(row.name);
      else map.set(row.recycled_clip_id, [row.name]);
    }
    return map;
  }

  /** The bin's checklists in one query — the mirror of `listClipItemsForClips`. */
  private recycledItems(recycledIds: number[]): Map<number, ClipItem[]> {
    const map = new Map<number, ClipItem[]>();
    if (recycledIds.length === 0) return map;

    const rows = this.db
      .prepare(
        `SELECT id, recycled_clip_id, text, is_done, done_at, sort_order, created_at
         FROM clp_recycled_clip_items
         WHERE recycled_clip_id IN (${recycledIds.map(() => "?").join(", ")})
         ORDER BY sort_order, id`,
      )
      .all(...recycledIds) as Array<{
      id: number;
      recycled_clip_id: number;
      text: string;
      is_done: number;
      done_at: string | null;
      sort_order: number;
      created_at: string;
    }>;

    for (const row of rows) {
      const item: ClipItem = {
        id: row.id,
        // The parent it hangs off while binned. A binned item's `clipId` is the
        // bin's key, not a live clip's — nothing may tick it, and the card in the
        // bin is read-only for exactly that reason.
        clipId: row.recycled_clip_id,
        text: row.text,
        isDone: row.is_done === 1,
        doneAt: row.done_at ?? undefined,
        sortOrder: row.sort_order,
        createdAt: row.created_at,
      };
      const list = map.get(row.recycled_clip_id);
      if (list) list.push(item);
      else map.set(row.recycled_clip_id, [item]);
    }
    return map;
  }

  restoreRecycledClips(recycledIds: number[]): number {
    if (recycledIds.length === 0) return 0;

    const readParent = this.db.prepare("SELECT * FROM clp_recycled_clips WHERE id = ?");
    const idTaken = this.db.prepare("SELECT 1 FROM clp_clips WHERE id = ?");

    // Two inserts, differing only in whether they name `id`. Restoring at the
    // original id keeps any existing clp_clip_links row — and the journal badge it
    // draws — pointing at the right clip; letting SQLite assign one is the fallback
    // when that id has been taken since.
    const insertAtId = this.db.prepare(
      `INSERT INTO clp_clips (
         id, title, content_html, is_encrypted, title_encrypted, content_encrypted,
         password_hint, is_pinned, card_color, created_by, created_at, updated_at
       ) VALUES (
         @id, @title, @content_html, @is_encrypted, @title_encrypted, @content_encrypted,
         @password_hint, @is_pinned, @card_color, @created_by, @created_at, @updated_at
       )`,
    );
    const insertFresh = this.db.prepare(
      `INSERT INTO clp_clips (
         title, content_html, is_encrypted, title_encrypted, content_encrypted,
         password_hint, is_pinned, card_color, created_by, created_at, updated_at
       ) VALUES (
         @title, @content_html, @is_encrypted, @title_encrypted, @content_encrypted,
         @password_hint, @is_pinned, @card_color, @created_by, @created_at, @updated_at
       )`,
    );

    // INSERT OR IGNORE on the two taxonomy tables, because both carry a UNIQUE
    // index on (clip_id, name): restoring at the original id, into a row the
    // category list has since been rebuilt around, must not fail the transaction.
    const restoreCategories = this.db.prepare(
      `INSERT OR IGNORE INTO clp_clip_categories (clip_id, category_name)
       SELECT ?, category_name FROM clp_recycled_clip_categories WHERE recycled_clip_id = ?`,
    );
    const restoreTags = this.db.prepare(
      `INSERT OR IGNORE INTO clp_clip_tags (clip_id, tag_name)
       SELECT ?, tag_name FROM clp_recycled_clip_tags WHERE recycled_clip_id = ?`,
    );
    const restoreImages = this.db.prepare(
      `INSERT INTO clp_clip_images
         (clip_id, image_data, mime_type, width, height, byte_size, sort_order, created_at)
       SELECT ?, image_data, mime_type, width, height, byte_size, sort_order, created_at
       FROM clp_recycled_clip_images WHERE recycled_clip_id = ? ORDER BY sort_order, id`,
    );
    const restoreItems = this.db.prepare(
      `INSERT INTO clp_clip_items (clip_id, text, is_done, done_at, sort_order, created_at)
       SELECT ?, text, is_done, done_at, sort_order, created_at
       FROM clp_recycled_clip_items WHERE recycled_clip_id = ? ORDER BY sort_order, id`,
    );
    const restoreLinks = this.db.prepare(
      `INSERT OR IGNORE INTO clp_clip_links (clip_id, target_module, target_id, created_at)
       SELECT ?, target_module, target_id, created_at
       FROM clp_recycled_clip_links WHERE recycled_clip_id = ?`,
    );

    let restored = 0;
    this.db.transaction(() => {
      for (const recycledId of recycledIds) {
        const row = readParent.get(recycledId) as RecycledClipRow | undefined;
        if (!row) continue;

        const params = {
          title: row.title,
          content_html: row.content_html,
          is_encrypted: row.is_encrypted,
          title_encrypted: row.title_encrypted,
          content_encrypted: row.content_encrypted,
          password_hint: row.password_hint,
          is_pinned: row.is_pinned,
          card_color: row.card_color,
          created_by: row.created_by,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };

        const clipId = idTaken.get(row.clip_id)
          ? Number(insertFresh.run(params).lastInsertRowid)
          : Number(insertAtId.run({ ...params, id: row.clip_id }).lastInsertRowid);

        restoreCategories.run(clipId, recycledId);
        restoreTags.run(clipId, recycledId);
        restoreImages.run(clipId, recycledId);
        restoreItems.run(clipId, recycledId);
        restoreLinks.run(clipId, recycledId);

        // The bin row and its children go in the same transaction as the restore:
        // a clip must not exist in both places at once, or the next restore would
        // make a second copy of it.
        this.purgeRecycledRow(recycledId);
        restored += 1;
      }
    })();

    return restored;
  }

  /**
   * Removes one bin row and its five children.
   *
   * Private, and shared by restore and purge, so there is exactly one list of the
   * bin's tables. A restore that forgot a child table would leave rows behind that
   * the next `emptyClipsRecycleBin` would not reach, since that works from the
   * parent ids.
   */
  private purgeRecycledRow(recycledId: number): void {
    this.db
      .prepare("DELETE FROM clp_recycled_clip_categories WHERE recycled_clip_id = ?")
      .run(recycledId);
    this.db.prepare("DELETE FROM clp_recycled_clip_tags WHERE recycled_clip_id = ?").run(recycledId);
    this.db
      .prepare("DELETE FROM clp_recycled_clip_images WHERE recycled_clip_id = ?")
      .run(recycledId);
    this.db
      .prepare("DELETE FROM clp_recycled_clip_items WHERE recycled_clip_id = ?")
      .run(recycledId);
    this.db
      .prepare("DELETE FROM clp_recycled_clip_links WHERE recycled_clip_id = ?")
      .run(recycledId);
    this.db.prepare("DELETE FROM clp_recycled_clips WHERE id = ?").run(recycledId);
  }

  deleteRecycledClipsForever(recycledIds: number[]): number {
    if (recycledIds.length === 0) return 0;

    const exists = this.db.prepare("SELECT 1 FROM clp_recycled_clips WHERE id = ?");

    let deleted = 0;
    this.db.transaction(() => {
      for (const recycledId of recycledIds) {
        // Checked first so the count reports rows that were actually there, rather
        // than counting a purge of something already gone.
        if (!exists.get(recycledId)) continue;
        this.purgeRecycledRow(recycledId);
        deleted += 1;
      }
    })();

    return deleted;
  }

  emptyClipsRecycleBin(): number {
    let deleted = 0;
    this.db.transaction(() => {
      deleted = this.countRecycledClips();
      // Unqualified deletes rather than a loop over `purgeRecycledRow`: emptying is
      // the one operation that takes every row, so there is no id to follow.
      this.db.prepare("DELETE FROM clp_recycled_clip_categories").run();
      this.db.prepare("DELETE FROM clp_recycled_clip_tags").run();
      this.db.prepare("DELETE FROM clp_recycled_clip_images").run();
      this.db.prepare("DELETE FROM clp_recycled_clip_items").run();
      this.db.prepare("DELETE FROM clp_recycled_clip_links").run();
      this.db.prepare("DELETE FROM clp_recycled_clips").run();
    })();
    return deleted;
  }

  countRecycledClips(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM clp_recycled_clips").get() as {
      n: number;
    };
    return row.n;
  }

  // Board

  setClipPinned(id: number, isPinned: boolean): Clip {
    this.db
      .prepare("UPDATE clp_clips SET is_pinned = ? WHERE id = ?")
      .run(isPinned ? 1 : 0, id);
    return this.getClipById(id)!;
  }

  setClipColor(id: number, color: ClipCardColor | ""): Clip {
    this.db.prepare("UPDATE clp_clips SET card_color = ? WHERE id = ?").run(color, id);
    return this.getClipById(id)!;
  }

  // Checklist items

  listClipItems(clipId: number): ClipItem[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM clp_clip_items WHERE clip_id = ? ORDER BY sort_order, id",
      )
      .all(clipId) as ItemRow[];
    return rows.map(toClipItem);
  }

  listClipItemsForClips(clipIds: number[]): Map<number, ClipItem[]> {
    const map = new Map<number, ClipItem[]>();
    if (clipIds.length === 0) return map;

    // Placeholders rather than a joined string: the ids are numbers here, but an
    // interpolated IN list is the habit that becomes an injection the first time one
    // of them is a string from a query param.
    const rows = this.db
      .prepare(
        `SELECT * FROM clp_clip_items
          WHERE clip_id IN (${clipIds.map(() => "?").join(", ")})
          ORDER BY sort_order, id`,
      )
      .all(...clipIds) as ItemRow[];

    for (const row of rows) {
      const item = toClipItem(row);
      const list = map.get(row.clip_id);
      if (list) list.push(item);
      else map.set(row.clip_id, [item]);
    }
    return map;
  }

  saveClipItems(clipId: number, items: ClipItemWriteData[]): ClipItem[] {
    this.db.transaction(() => {
      // Anything the editor did not send back has been removed by the reader.
      // Computed before the writes so a kept id is never seen as missing.
      const keptIds = new Set(items.map((item) => item.id).filter((id) => id !== undefined));
      const existing = this.db
        .prepare("SELECT id FROM clp_clip_items WHERE clip_id = ?")
        .all(clipId) as Array<{ id: number }>;

      for (const row of existing) {
        if (!keptIds.has(row.id)) {
          this.db.prepare("DELETE FROM clp_clip_items WHERE id = ?").run(row.id);
        }
      }

      items.forEach((item, index) => {
        if (item.id === undefined) {
          this.db
            .prepare(
              `INSERT INTO clp_clip_items (clip_id, text, is_done, done_at, sort_order)
               VALUES (@clipId, @text, @isDone, @doneAt, @sortOrder)`,
            )
            .run({
              clipId,
              text: item.text,
              isDone: item.isDone ? 1 : 0,
              // A line typed as already-ticked is stamped now; an untouched one has
              // no timestamp at all, never a sentinel date.
              doneAt: item.isDone ? new Date().toISOString() : null,
              sortOrder: index,
            });
          return;
        }

        // `done_at` is written only when `is_done` actually changes, so a save that
        // merely reorders or retypes a line does not restamp when it was ticked.
        this.db
          .prepare(
            `UPDATE clp_clip_items
                SET text = @text,
                    sort_order = @sortOrder,
                    done_at = CASE
                      WHEN is_done = @isDone THEN done_at
                      WHEN @isDone = 1 THEN @now
                      ELSE NULL
                    END,
                    is_done = @isDone
              WHERE id = @id AND clip_id = @clipId`,
          )
          .run({
            id: item.id,
            clipId,
            text: item.text,
            isDone: item.isDone ? 1 : 0,
            sortOrder: index,
            now: new Date().toISOString(),
          });
      });
    })();

    return this.listClipItems(clipId);
  }

  toggleClipItem(itemId: number, isDone: boolean): ClipItem {
    // Keyed by the item alone, with no clip id to check it against. Safe because a
    // clip is shared: everyone granted the module may read and tick every clip, the
    // same model `tol_todo_items` uses (migration 0123). There is no per-reader clip
    // to cross into, so the only gate is module access, which the action enforces.
    this.db
      .prepare("UPDATE clp_clip_items SET is_done = ?, done_at = ? WHERE id = ?")
      .run(isDone ? 1 : 0, isDone ? new Date().toISOString() : null, itemId);

    const row = this.db.prepare("SELECT * FROM clp_clip_items WHERE id = ?").get(itemId) as
      | ItemRow
      | undefined;
    if (!row) throw new Error(`No clip item with id ${itemId}.`);
    return toClipItem(row);
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

/**
 * One item row as a domain object.
 *
 * A free function rather than a method: it needs no database handle, and keeping it
 * out of the class makes clear that mapping a row is not a query.
 *
 * `done_at` maps NULL to `undefined` rather than `""` — the one place this module
 * carries a genuinely optional value, because "not completed" has no timestamp.
 */
function toClipItem(row: ItemRow): ClipItem {
  return {
    id: row.id,
    clipId: row.clip_id,
    text: row.text,
    isDone: row.is_done === 1,
    doneAt: row.done_at ?? undefined,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}
