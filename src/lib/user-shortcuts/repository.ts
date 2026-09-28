import type Database from "better-sqlite3";
import type { UserShortcutsRepository } from "./ports";
import type { Shortcut, ShortcutDraft, ShortcutKind } from "./types";

interface ShortcutRow {
  id: number;
  user_id: number;
  kind: string;
  name: string;
  icon: string;
  /** `0` or `1` from SQLite — derived, never the bytes. See `COLUMNS`. */
  has_icon_image: number;
  url: string;
  module_slug: string;
  section_id: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** A row to the domain type — a repository never hands a caller a raw row. */
function toShortcut(row: ShortcutRow): Shortcut {
  return {
    id: row.id,
    userId: row.user_id,
    // The column is CHECK-constrained to these two, so the cast states what the
    // database already guarantees rather than hiding a decision.
    kind: row.kind as ShortcutKind,
    name: row.name,
    icon: row.icon,
    hasIconImage: row.has_icon_image === 1,
    url: row.url,
    moduleSlug: row.module_slug,
    sectionId: row.section_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Every column an ordinary read needs — and deliberately **not** `icon_image`.
 *
 * This is the non-obvious obligation `coding-guide.md` attaches to a per-row
 * BLOB: a `SELECT *` here would carry every reader's uploaded pictures through
 * every home-screen render. Presence is derived in SQL instead, so a caller can
 * pick artwork-or-glyph without the bytes ever leaving the database. The one
 * place that reads them is `getIcon`.
 */
const COLUMNS = `id, user_id, kind, name, icon,
                 icon_image IS NOT NULL AS has_icon_image,
                 url, module_slug, section_id,
                 sort_order, created_at, updated_at`;

/**
 * The shortcuts — the only file in this module that knows SQL.
 *
 * **Every statement filters on `user_id`.** That is not defensive repetition:
 * it is the invariant `UserShortcutsRepository` documents, and it is what makes
 * an id arriving from a client safe to act on without a separate ownership
 * check at the call site. There is deliberately no method that reads across
 * users, so no caller can accidentally ask for one.
 */
export class SqliteUserShortcutsRepository implements UserShortcutsRepository {
  constructor(private readonly db: Database.Database) {}

  list(userId: number): Shortcut[] {
    // `(sort_order, id)`, not `sort_order` alone: positions can tie (a reorder
    // that dropped a stale id, or several rows created before anyone
    // rearranged them), and a tie broken by insertion order is stable where an
    // unordered tie is not — a card that reshuffles between page loads looks
    // broken. Same reasoning as the scratchpad's tab strip.
    const rows = this.db
      .prepare(
        `SELECT ${COLUMNS} FROM sys_user_shortcuts
         WHERE user_id = ?
         ORDER BY sort_order ASC, id ASC`,
      )
      .all(userId) as ShortcutRow[];
    return rows.map(toShortcut);
  }

  findById(userId: number, id: number): Shortcut | undefined {
    const row = this.db
      .prepare(`SELECT ${COLUMNS} FROM sys_user_shortcuts WHERE user_id = ? AND id = ?`)
      .get(userId, id) as ShortcutRow | undefined;
    return row ? toShortcut(row) : undefined;
  }

  count(userId: number): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM sys_user_shortcuts WHERE user_id = ?`)
      .get(userId) as { n: number };
    return row.n;
  }

  create(userId: number, draft: ShortcutDraft): Shortcut {
    // One past this person's current last, computed in the same statement that
    // inserts rather than read first and passed in: two tabs adding at once
    // would otherwise both read the same maximum and land on the same position.
    // A tie would still sort stably by id, but the drift is free to avoid here.
    const info = this.db
      .prepare(
        `INSERT INTO sys_user_shortcuts
           (user_id, kind, name, icon, url, module_slug, section_id, sort_order)
         VALUES (
           @userId, @kind, @name, @icon, @url, @moduleSlug, @sectionId,
           (SELECT COALESCE(MAX(sort_order), -1) + 1
              FROM sys_user_shortcuts WHERE user_id = @userId)
         )`,
      )
      .run({ userId, ...draft });

    // Non-null: the insert above just succeeded, so the row is there.
    return this.findById(userId, Number(info.lastInsertRowid))!;
  }

  update(userId: number, id: number, draft: ShortcutDraft): Shortcut | undefined {
    // Every column the draft owns is written, including the ones the new kind
    // does not use (which arrive as ""). A partial update would leave a URL
    // behind on a row that is now a section shortcut — see the port's comment.
    // `sort_order` is untouched: editing a shortcut must not move it. Nor is
    // `icon_image` — the upload is managed by its own two methods below, so
    // renaming a shortcut keeps its picture. The `icon` glyph underneath is
    // still written, which is what the tile falls back to if the picture is
    // later cleared.
    const info = this.db
      .prepare(
        `UPDATE sys_user_shortcuts
            SET kind = @kind, name = @name, icon = @icon, url = @url,
                module_slug = @moduleSlug, section_id = @sectionId
          WHERE user_id = @userId AND id = @id`,
      )
      .run({ userId, id, ...draft });

    return info.changes > 0 ? this.findById(userId, id) : undefined;
  }

  delete(userId: number, id: number): boolean {
    const info = this.db
      .prepare(`DELETE FROM sys_user_shortcuts WHERE user_id = ? AND id = ?`)
      .run(userId, id);
    return info.changes > 0;
  }

  reorder(userId: number, ids: readonly number[]): Shortcut[] {
    const write = this.db.prepare(
      `UPDATE sys_user_shortcuts SET sort_order = ? WHERE user_id = ? AND id = ?`,
    );

    // One transaction, so the card can never be read half-reordered by another
    // request landing between two writes. An id that isn't this person's simply
    // matches no row — which is how both a stale id and someone else's id are
    // ignored rather than throwing.
    this.db.transaction(() => {
      ids.forEach((id, position) => write.run(position, userId, id));
    })();

    return this.list(userId);
  }

  getIcon(userId: number, id: number): { data: Buffer; mimeType: string } | undefined {
    // The only statement in this file that names `icon_image`. Scoped by
    // user_id like every other read, and here that is what makes the serving
    // route safe: another reader's id matches no row, so it cannot be used to
    // pull their picture.
    const row = this.db
      .prepare(
        `SELECT icon_image, icon_mime_type FROM sys_user_shortcuts
         WHERE user_id = ? AND id = ?`,
      )
      .get(userId, id) as { icon_image: Buffer | null; icon_mime_type: string } | undefined;

    // A row with no upload is not a miss for the caller to distinguish — both
    // mean "serve nothing", and collapsing them keeps the route to one branch.
    if (!row?.icon_image) return undefined;
    return { data: row.icon_image, mimeType: row.icon_mime_type };
  }

  setIcon(userId: number, id: number, image: { data: Buffer; mimeType: string }): boolean {
    const info = this.db
      .prepare(
        `UPDATE sys_user_shortcuts
            SET icon_image = ?, icon_mime_type = ?
          WHERE user_id = ? AND id = ?`,
      )
      .run(image.data, image.mimeType, userId, id);
    return info.changes > 0;
  }

  clearIcon(userId: number, id: number): boolean {
    // `icon` is untouched on purpose — it is always populated, so dropping the
    // picture reveals the glyph underneath instead of blanking the tile.
    const info = this.db
      .prepare(
        `UPDATE sys_user_shortcuts
            SET icon_image = NULL, icon_mime_type = ''
          WHERE user_id = ? AND id = ?`,
      )
      .run(userId, id);
    return info.changes > 0;
  }
}
