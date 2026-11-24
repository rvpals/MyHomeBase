// The only file in this module that knows SQL.
//
// Returns domain types, never raw driver rows. No DB-level foreign keys, per
// project convention — the cascades below are maintained here, in transactions.

import type Database from "better-sqlite3";
import type { CodeLibraryRepository } from "./ports";
import { displayTitle } from "@/lib/shared/encryption";
import { toTintColor } from "@/lib/shared/tint";
import {
  toSnippetLanguage,
  type ColorSnippetInput,
  type CreateSnippetData,
  type PinSnippetInput,
  type SnippetFilterInput,
  type SnippetTaxonomyWriteInput,
  type UpdateSnippetData,
} from "./schema";
import type {
  RecycledSnippet,
  Snippet,
  SnippetSummary,
  SnippetTaxonomyItem,
} from "./types";

interface SnippetRow {
  id: number;
  title: string;
  code: string;
  language: string;
  is_pinned: number;
  card_color: string;
  source_url: string;
  notes: string;
  is_encrypted: number;
  title_encrypted: string;
  code_encrypted: string;
  password_hint: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface TaxonomyRow {
  name: string;
  description: string;
  usage_count: number;
}

/**
 * The opening lines of a snippet, verbatim.
 *
 * Cut by **line**, not by character: one line is the unit a reader scans, and
 * slicing at a character count would leave a half-identifier at the edge of every
 * card. The ellipsis marks that there is more, so a card does not imply the
 * snippet is six lines long when it is six hundred.
 *
 * Exported for the test. Not exported from `index.ts` — it is how this repository
 * builds a projection, not something a caller should reach for.
 */
export function buildSnippetPreview(code: string, previewLines: number): string {
  const lines = code.split("\n");
  if (lines.length <= previewLines) return code;
  return `${lines.slice(0, previewLines).join("\n")}\n…`;
}

/**
 * How many lines a snippet has.
 *
 * Counted from the whole body before the preview is cut, which is the entire
 * reason it is carried on the summary at all — a card cannot derive it from a
 * truncated preview.
 *
 * An empty body is 0 lines, not 1: `"".split("\n")` yields `[""]`, and reporting
 * "1 line" for an empty snippet reads as a bug to anyone looking at it.
 */
export function countSnippetLines(code: string): number {
  return code === "" ? 0 : code.split("\n").length;
}

/**
 * The one ordering every snippet read uses.
 *
 * A constant rather than repeated in each query: the list and any later board
 * view must not be able to disagree about where a pinned snippet sits. Pin first,
 * then most recently touched, then id so a page saved within the same second is
 * still deterministic.
 */
const SNIPPET_ORDER = "ORDER BY is_pinned DESC, updated_at DESC, id DESC";

export class SqliteCodeLibraryRepository implements CodeLibraryRepository {
  constructor(private readonly db: Database.Database) {}

  // Snippets

  listSnippets(filter: SnippetFilterInput, previewLines: number): SnippetSummary[] {
    const wheres: string[] = [];
    const params: unknown[] = [];

    if (filter.search !== "") {
      // Over `code` directly, and this is the payoff for storing plain text: the
      // body is not entity-escaped, so `List<string>` and `a && b` match what a
      // reader actually typed. The same search against a clip's `content_html`
      // cannot, because `<` is stored as `&lt;`.
      wheres.push("(s.title LIKE ? OR s.code LIKE ?)");
      const like = `%${filter.search}%`;
      params.push(like, like);
    }

    if (filter.language !== "") {
      // Compared as the raw string rather than through `toSnippetLanguage`: a
      // filter naming a language that no longer exists must match nothing, which
      // is what this does. Folding it to `text` first would instead show every
      // plain-text snippet, a confusing answer to a stale URL.
      wheres.push("s.language = ?");
      params.push(filter.language);
    }

    // AND semantics: picking two categories means snippets carrying BOTH. The
    // `HAVING COUNT(DISTINCT …)` over the matched pairings is what makes that
    // work — an `IN` alone would mean either.
    if (filter.categories.length > 0) {
      wheres.push(`s.id IN (
        SELECT snippet_id FROM cod_snippet_categories
        WHERE category_name IN (${filter.categories.map(() => "?").join(", ")}) COLLATE NOCASE
        GROUP BY snippet_id HAVING COUNT(DISTINCT category_name) = ?
      )`);
      params.push(...filter.categories, filter.categories.length);
    }

    if (filter.tags.length > 0) {
      wheres.push(`s.id IN (
        SELECT snippet_id FROM cod_snippet_tags
        WHERE tag_name IN (${filter.tags.map(() => "?").join(", ")}) COLLATE NOCASE
        GROUP BY snippet_id HAVING COUNT(DISTINCT tag_name) = ?
      )`);
      params.push(...filter.tags, filter.tags.length);
    }

    const where = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";

    const rows = this.db
      .prepare(
        `SELECT s.id, s.title, s.code, s.language, s.is_pinned, s.card_color, s.source_url, s.notes,
                s.is_encrypted, s.title_encrypted, s.code_encrypted, s.password_hint,
                s.created_by, s.created_at, s.updated_at
           FROM cod_snippets s
           ${where}
           ${SNIPPET_ORDER}`,
      )
      .all(...params) as SnippetRow[];

    // Taxonomy for the whole page in two queries rather than two per row: a list
    // of 200 snippets would otherwise cost 400 round trips to draw its chips.
    const ids = rows.map((row) => row.id);
    const categories = this.pairingsFor("cod_snippet_categories", "category_name", ids);
    const tags = this.pairingsFor("cod_snippet_tags", "tag_name", ids);

    return rows.map((row) => ({
      id: row.id,
      // "(encrypted)" for a sealed row — the shared helper, so a sealed
      // snippet, clip and journal entry all read the same.
      title: displayTitle(row.title, row.is_encrypted === 1),
      // A sealed row has no plaintext, and both of these must stay blank rather
      // than leaking a preview of the ciphertext. `code` blank also means the
      // Copy button has nothing to copy, which is why the card hides it.
      preview: row.is_encrypted === 1 ? "" : buildSnippetPreview(row.code, previewLines),
      // The whole body, for the card's Copy button. See `SnippetSummary.code`
      // for why this projection carries it.
      code: row.is_encrypted === 1 ? "" : row.code,
      language: toSnippetLanguage(row.language),
      lineCount: row.is_encrypted === 1 ? 0 : countSnippetLines(row.code),
      categories: categories.get(row.id) ?? [],
      tags: tags.get(row.id) ?? [],
      isPinned: row.is_pinned === 1,
      // Widened back into the union here. A stored key that is no longer in the
      // palette reads as "" — the default surface — rather than throwing.
      color: toTintColor(row.card_color),
      sourceUrl: row.source_url,
      notes: row.notes,
      isEncrypted: row.is_encrypted === 1,
      passwordHint: row.password_hint,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getSnippetById(id: number): Snippet | undefined {
    const row = this.db
      .prepare(
        `SELECT id, title, code, language, is_pinned, card_color, source_url, notes,
                is_encrypted, title_encrypted, code_encrypted, password_hint,
                created_by, created_at, updated_at
           FROM cod_snippets
          WHERE id = ?`,
      )
      .get(id) as SnippetRow | undefined;

    if (!row) return undefined;

    return {
      id: row.id,
      title: row.title,
      code: row.code,
      language: toSnippetLanguage(row.language),
      categories: this.namesFor("cod_snippet_categories", "category_name", id),
      tags: this.namesFor("cod_snippet_tags", "tag_name", id),
      isPinned: row.is_pinned === 1,
      color: toTintColor(row.card_color),
      sourceUrl: row.source_url,
      notes: row.notes,
      isEncrypted: row.is_encrypted === 1,
      titleEncrypted: row.title_encrypted,
      codeEncrypted: row.code_encrypted,
      passwordHint: row.password_hint,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createSnippet(input: CreateSnippetData, createdBy: number | null): Snippet {
    // One transaction: a snippet whose pairings failed half-way would be filed
    // under some of its categories and not the rest, with nothing to say so.
    const write = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `INSERT INTO cod_snippets (title, code, language, source_url, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(input.title, input.code, input.language, input.sourceUrl, input.notes, createdBy);

      const id = Number(result.lastInsertRowid);
      this.replacePairings(id, input.categories, input.tags);
      return id;
    });

    // Read back rather than assembling the row from the input: `created_at` and
    // `updated_at` are column defaults, so the database is the only thing that
    // knows them. Non-null because the INSERT above succeeded.
    return this.getSnippetById(write()) as Snippet;
  }

  updateSnippet(input: UpdateSnippetData): Snippet | undefined {
    const saved = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `UPDATE cod_snippets
              SET title = ?, code = ?, language = ?, source_url = ?, notes = ?
            WHERE id = ?`,
        )
        .run(input.title, input.code, input.language, input.sourceUrl, input.notes, input.id);

      // `changes === 0` means the id is gone — deleted in another tab, or never
      // existed. Reported as `undefined` rather than silently succeeding, so the
      // caller can say so instead of showing a save that did nothing. Returning
      // before the pairings are touched also stops an edit resurrecting the
      // taxonomy of a snippet that no longer exists.
      if (result.changes === 0) return false;

      this.replacePairings(input.id, input.categories, input.tags);
      return true;
    });

    if (!saved()) return undefined;

    // `updated_at` is maintained by the table's trigger, so it is not in the SET
    // above and has to be read back to be returned accurately.
    return this.getSnippetById(input.id);
  }

  setSnippetPinned(input: PinSnippetInput): boolean {
    const result = this.db
      .prepare("UPDATE cod_snippets SET is_pinned = ? WHERE id = ?")
      .run(input.isPinned ? 1 : 0, input.id);

    return result.changes > 0;
  }

  setSnippetColor(input: ColorSnippetInput): boolean {
    // The key as given — the schema has already refused anything outside the
    // palette, and storing `''` is how a tint is cleared.
    const result = this.db
      .prepare("UPDATE cod_snippets SET card_color = ? WHERE id = ?")
      .run(input.color, input.id);

    return result.changes > 0;
  }

  sealSnippet(
    id: number,
    titleEncrypted: string,
    codeEncrypted: string,
    passwordHint: string,
  ): boolean {
    // The plaintext columns are blanked in the same statement that writes the
    // ciphertext. Two statements would leave a window where both existed, and a
    // crash between them would leave the plaintext sitting there under a row
    // that claims to be sealed.
    const result = this.db
      .prepare(
        `UPDATE cod_snippets
            SET is_encrypted = 1,
                title_encrypted = ?,
                code_encrypted = ?,
                password_hint = ?,
                title = '',
                code = ''
          WHERE id = ?`,
      )
      .run(titleEncrypted, codeEncrypted, passwordHint, id);

    return result.changes > 0;
  }

  unsealSnippet(id: number, title: string, code: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE cod_snippets
            SET is_encrypted = 0,
                title_encrypted = '',
                code_encrypted = '',
                password_hint = '',
                title = ?,
                code = ?
          WHERE id = ?`,
      )
      .run(title, code, id);

    return result.changes > 0;
  }

  // The recycle bin

  recycleSnippet(id: number): boolean {
    const move = this.db.transaction(() => {
      const copied = this.db
        .prepare(
          `INSERT INTO cod_recycled_snippets (
             snippet_id, title, code, language, is_pinned, card_color,
             source_url, notes, is_encrypted, title_encrypted, code_encrypted,
             password_hint, created_by, created_at, updated_at
           )
           SELECT id, title, code, language, is_pinned, card_color,
                  source_url, notes, is_encrypted, title_encrypted, code_encrypted,
                  password_hint, created_by, created_at, updated_at
             FROM cod_snippets WHERE id = ?`,
        )
        .run(id);

      if (copied.changes === 0) return false;

      const recycledId = Number(copied.lastInsertRowid);

      // Keyed by the BIN row's id, not the snippet's: the same snippet can be
      // binned, restored and binned again, and keying on the snippet id would
      // merge two separate deletions' labels.
      this.db
        .prepare(
          `INSERT INTO cod_recycled_snippet_categories (recycled_snippet_id, category_name)
           SELECT ?, category_name FROM cod_snippet_categories WHERE snippet_id = ?`,
        )
        .run(recycledId, id);
      this.db
        .prepare(
          `INSERT INTO cod_recycled_snippet_tags (recycled_snippet_id, tag_name)
           SELECT ?, tag_name FROM cod_snippet_tags WHERE snippet_id = ?`,
        )
        .run(recycledId, id);

      this.db.prepare("DELETE FROM cod_snippet_categories WHERE snippet_id = ?").run(id);
      this.db.prepare("DELETE FROM cod_snippet_tags WHERE snippet_id = ?").run(id);
      this.db.prepare("DELETE FROM cod_snippets WHERE id = ?").run(id);

      return true;
    });

    return move();
  }

  listRecycledSnippets(previewLines: number): RecycledSnippet[] {
    const rows = this.db
      .prepare(
        `SELECT id, snippet_id, title, code, language, is_encrypted, deleted_at
           FROM cod_recycled_snippets
          ORDER BY deleted_at DESC, id DESC`,
      )
      .all() as {
      id: number;
      snippet_id: number;
      title: string;
      code: string;
      language: string;
      is_encrypted: number;
      deleted_at: string;
    }[];

    const ids = rows.map((row) => row.id);
    const categories = this.pairingsFor(
      "cod_recycled_snippet_categories",
      "category_name",
      ids,
      "recycled_snippet_id",
    );
    const tags = this.pairingsFor(
      "cod_recycled_snippet_tags",
      "tag_name",
      ids,
      "recycled_snippet_id",
    );

    return rows.map((row) => {
      const sealed = row.is_encrypted === 1;
      return {
        id: row.id,
        snippetId: row.snippet_id,
        title: displayTitle(row.title, sealed),
        preview: sealed ? "" : buildSnippetPreview(row.code, previewLines),
        language: toSnippetLanguage(row.language),
        lineCount: sealed ? 0 : countSnippetLines(row.code),
        isEncrypted: sealed,
        categories: categories.get(row.id) ?? [],
        tags: tags.get(row.id) ?? [],
        deletedAt: row.deleted_at,
      };
    });
  }

  restoreRecycledSnippet(recycledId: number): number | undefined {
    const restore = this.db.transaction(() => {
      const row = this.db
        .prepare("SELECT * FROM cod_recycled_snippets WHERE id = ?")
        .get(recycledId) as (SnippetRow & { snippet_id: number }) | undefined;

      if (!row) return undefined;

      // Aim at the ORIGINAL id so an existing reference survives a
      // delete-and-restore. `restoreRecycledEntries` set this precedent; nothing
      // points at a snippet today, but a later feature that does would otherwise
      // find a dangling id.
      const taken =
        this.db.prepare("SELECT 1 FROM cod_snippets WHERE id = ?").get(row.snippet_id) !==
        undefined;

      const columns = `title, code, language, is_pinned, card_color, source_url, notes,
                       is_encrypted, title_encrypted, code_encrypted, password_hint,
                       created_by, created_at, updated_at`;
      const values = [
        row.title,
        row.code,
        row.language,
        row.is_pinned,
        row.card_color,
        row.source_url,
        row.notes,
        row.is_encrypted,
        row.title_encrypted,
        row.code_encrypted,
        row.password_hint,
        row.created_by,
        row.created_at,
        row.updated_at,
      ];

      const inserted = taken
        ? this.db
            .prepare(
              `INSERT INTO cod_snippets (${columns}) VALUES (${values.map(() => "?").join(", ")})`,
            )
            .run(...values)
        : this.db
            .prepare(
              `INSERT INTO cod_snippets (id, ${columns})
               VALUES (?, ${values.map(() => "?").join(", ")})`,
            )
            .run(row.snippet_id, ...values);

      const newId = taken ? Number(inserted.lastInsertRowid) : row.snippet_id;

      // The labels come back with it. Restoring a snippet without them restores
      // something less than what was deleted. `INSERT OR IGNORE` on the
      // vocabulary because the word may have been retired while it was binned.
      const categories = this.db
        .prepare(
          "SELECT category_name AS name FROM cod_recycled_snippet_categories WHERE recycled_snippet_id = ?",
        )
        .all(recycledId) as { name: string }[];
      const tags = this.db
        .prepare(
          "SELECT tag_name AS name FROM cod_recycled_snippet_tags WHERE recycled_snippet_id = ?",
        )
        .all(recycledId) as { name: string }[];

      this.replacePairings(
        newId,
        categories.map((entry) => entry.name),
        tags.map((entry) => entry.name),
      );

      this.purgeRows(recycledId);
      return newId;
    });

    return restore();
  }

  purgeRecycledSnippet(recycledId: number): boolean {
    const purge = this.db.transaction(() => {
      const exists =
        this.db.prepare("SELECT 1 FROM cod_recycled_snippets WHERE id = ?").get(recycledId) !==
        undefined;
      if (!exists) return false;
      this.purgeRows(recycledId);
      return true;
    });

    return purge();
  }

  emptyRecycleBin(): number {
    const empty = this.db.transaction(() => {
      const { count } = this.db
        .prepare("SELECT COUNT(*) AS count FROM cod_recycled_snippets")
        .get() as { count: number };

      this.db.prepare("DELETE FROM cod_recycled_snippet_categories").run();
      this.db.prepare("DELETE FROM cod_recycled_snippet_tags").run();
      this.db.prepare("DELETE FROM cod_recycled_snippets").run();

      return count;
    });

    return empty();
  }

  /** Destroys one bin row and its mirrored pairings. Always inside a transaction. */
  private purgeRows(recycledId: number): void {
    this.db
      .prepare("DELETE FROM cod_recycled_snippet_categories WHERE recycled_snippet_id = ?")
      .run(recycledId);
    this.db
      .prepare("DELETE FROM cod_recycled_snippet_tags WHERE recycled_snippet_id = ?")
      .run(recycledId);
    this.db.prepare("DELETE FROM cod_recycled_snippets WHERE id = ?").run(recycledId);
  }

  // Taxonomy

  listCategories(): SnippetTaxonomyItem[] {
    return this.listTaxonomy("cod_categories", "cod_snippet_categories", "category_name");
  }

  listTags(): SnippetTaxonomyItem[] {
    return this.listTaxonomy("cod_tags", "cod_snippet_tags", "tag_name");
  }

  saveCategory(input: SnippetTaxonomyWriteInput): void {
    this.saveTaxonomy("cod_categories", "cod_snippet_categories", "category_name", input);
  }

  saveTag(input: SnippetTaxonomyWriteInput): void {
    this.saveTaxonomy("cod_tags", "cod_snippet_tags", "tag_name", input);
  }

  deleteCategory(name: string): void {
    this.deleteTaxonomy("cod_categories", "cod_snippet_categories", "category_name", name);
  }

  deleteTag(name: string): void {
    this.deleteTaxonomy("cod_tags", "cod_snippet_tags", "tag_name", name);
  }

  // Shared internals.
  //
  // Categories and tags are the same table shape with different names, so the
  // four pairs above delegate here rather than each being written twice. The
  // table and column names are supplied by this file alone and never by a
  // caller — they are interpolated into SQL, which would be an injection hole if
  // they came from anywhere else.

  private listTaxonomy(
    table: string,
    pairingTable: string,
    pairingColumn: string,
  ): SnippetTaxonomyItem[] {
    const rows = this.db
      .prepare(
        `SELECT t.name,
                t.description,
                (SELECT COUNT(*) FROM ${pairingTable} p
                  WHERE p.${pairingColumn} = t.name COLLATE NOCASE) AS usage_count
           FROM ${table} t
          ORDER BY t.name COLLATE NOCASE`,
      )
      .all() as TaxonomyRow[];

    return rows.map((row) => ({
      name: row.name,
      description: row.description,
      usageCount: row.usage_count,
    }));
  }

  private saveTaxonomy(
    table: string,
    pairingTable: string,
    pairingColumn: string,
    input: SnippetTaxonomyWriteInput,
  ): void {
    const isRename =
      input.previousName !== "" &&
      input.previousName.toLowerCase() !== input.name.toLowerCase();

    const write = this.db.transaction(() => {
      if (isRename) {
        this.db
          .prepare(`UPDATE ${table} SET name = ?, description = ? WHERE name = ?`)
          .run(input.name, input.description, input.previousName);
        // The pairings carry the name, so they are rewritten here or every
        // snippet filed under the old word is orphaned.
        this.db
          .prepare(`UPDATE ${pairingTable} SET ${pairingColumn} = ? WHERE ${pairingColumn} = ?`)
          .run(input.name, input.previousName);
        return;
      }

      // Upsert on the primary key. A description-only edit and a brand-new entry
      // are the same write, which is what the management screen submits either
      // way.
      this.db
        .prepare(
          `INSERT INTO ${table} (name, description) VALUES (?, ?)
           ON CONFLICT(name) DO UPDATE SET description = excluded.description`,
        )
        .run(input.name, input.description);
    });

    write();
  }

  private deleteTaxonomy(
    table: string,
    pairingTable: string,
    pairingColumn: string,
    name: string,
  ): void {
    const remove = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM ${table} WHERE name = ?`).run(name);
      // The pairings go with it. Retiring a word should not require unfiling
      // every snippet by hand first; the snippets themselves are untouched.
      this.db
        .prepare(`DELETE FROM ${pairingTable} WHERE ${pairingColumn} = ?`)
        .run(name);
    });

    remove();
  }

  /**
   * Replaces one snippet's category and tag pairings.
   *
   * Creates any name that is not in the managed list yet, so typing a new tag in
   * the editor files the snippet *and* adds the word — the alternative is making
   * someone visit a second screen before they can label anything.
   *
   * Always called inside a transaction by its callers.
   */
  private replacePairings(snippetId: number, categories: string[], tags: string[]): void {
    this.db.prepare("DELETE FROM cod_snippet_categories WHERE snippet_id = ?").run(snippetId);
    this.db.prepare("DELETE FROM cod_snippet_tags WHERE snippet_id = ?").run(snippetId);

    const addCategory = this.db.prepare(
      "INSERT OR IGNORE INTO cod_snippet_categories (snippet_id, category_name) VALUES (?, ?)",
    );
    const ensureCategory = this.db.prepare(
      "INSERT OR IGNORE INTO cod_categories (name) VALUES (?)",
    );
    for (const name of categories) {
      ensureCategory.run(name);
      addCategory.run(snippetId, name);
    }

    const addTag = this.db.prepare(
      "INSERT OR IGNORE INTO cod_snippet_tags (snippet_id, tag_name) VALUES (?, ?)",
    );
    const ensureTag = this.db.prepare("INSERT OR IGNORE INTO cod_tags (name) VALUES (?)");
    for (const name of tags) {
      ensureTag.run(name);
      addTag.run(snippetId, name);
    }
  }

  /** One snippet's names from a pairing table, alphabetical. */
  private namesFor(table: string, column: string, snippetId: number): string[] {
    const rows = this.db
      .prepare(
        `SELECT ${column} AS name FROM ${table}
          WHERE snippet_id = ? ORDER BY ${column} COLLATE NOCASE`,
      )
      .all(snippetId) as { name: string }[];

    return rows.map((row) => row.name);
  }

  /**
   * Names for many snippets at once, keyed by snippet id.
   *
   * One query for the whole page. An empty id list short-circuits rather than
   * building `IN ()`, which is a syntax error in SQLite.
   */
  private pairingsFor(
    table: string,
    column: string,
    snippetIds: number[],
    // The bin's mirrors key on `recycled_snippet_id`, so the parent column is a
    // parameter rather than assumed. Supplied by this file alone — it is
    // interpolated into SQL, which would be an injection hole from anywhere else.
    parentColumn = "snippet_id",
  ): Map<number, string[]> {
    const byId = new Map<number, string[]>();
    if (snippetIds.length === 0) return byId;

    const rows = this.db
      .prepare(
        `SELECT ${parentColumn} AS parent, ${column} AS name FROM ${table}
          WHERE ${parentColumn} IN (${snippetIds.map(() => "?").join(", ")})
          ORDER BY ${column} COLLATE NOCASE`,
      )
      .all(...snippetIds) as { parent: number; name: string }[];

    for (const row of rows) {
      const names = byId.get(row.parent);
      if (names) names.push(row.name);
      else byId.set(row.parent, [row.name]);
    }

    return byId;
  }
}
