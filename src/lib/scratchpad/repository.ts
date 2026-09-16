import type Database from "better-sqlite3";
import type { NoteCategoryRepository, ScratchpadRepository } from "./ports";
import type { Note, NoteCategory } from "./types";

interface CategoryRow {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

interface NoteRow {
  id: number;
  user_id: number;
  category_id: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

/** Rows to domain types — a repository never hands a caller a raw row. */
function toCategory(row: CategoryRow): NoteCategory {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    title: row.title,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The categories — one of the two files in the scratchpad that knows SQL.
 *
 * Household-wide, so unlike the notes below **nothing here is scoped by user**. That is
 * the ownership split migration 0096 draws: the tab strip is shared structure an admin
 * configures, and only the notes inside it are private.
 */
export class SqliteNoteCategoryRepository implements NoteCategoryRepository {
  constructor(private readonly db: Database.Database) {}

  list(): NoteCategory[] {
    // `(sort_order, id)`, not `sort_order` alone: positions can tie (a reorder that
    // dropped a stale id, or the seeded rows before anyone rearranges them), and a tie
    // broken by insertion order is stable where an unordered tie is not — a tab strip
    // that reshuffles between page loads looks broken.
    const rows = this.db
      .prepare(
        `SELECT id, name, sort_order, created_at
         FROM sys_scratchpad_categories
         ORDER BY sort_order ASC, id ASC`,
      )
      .all() as CategoryRow[];
    return rows.map(toCategory);
  }

  findById(id: number): NoteCategory | undefined {
    const row = this.db
      .prepare(
        `SELECT id, name, sort_order, created_at
         FROM sys_scratchpad_categories WHERE id = ?`,
      )
      .get(id) as CategoryRow | undefined;
    return row ? toCategory(row) : undefined;
  }

  isNameTaken(name: string, exceptId?: number): boolean {
    // `COLLATE NOCASE` matches the unique index, so this check and the constraint that
    // backs it agree about what a duplicate is. `id != ?` with a sentinel rather than
    // two separate statements: -1 can never be a real id, so the `exceptId` and
    // no-exception cases share one prepared statement.
    const row = this.db
      .prepare(
        `SELECT 1 FROM sys_scratchpad_categories
         WHERE name = ? COLLATE NOCASE AND id != ?
         LIMIT 1`,
      )
      .get(name, exceptId ?? -1);
    return row !== undefined;
  }

  create(name: string): NoteCategory {
    const write = this.db.transaction((): NoteCategory => {
      // Appended at the end of the strip. `MAX(sort_order) + 1` inside the transaction
      // rather than a count, because deletes leave gaps and a count would hand a new
      // category a position an existing one already holds.
      const { next } = this.db
        .prepare(
          `SELECT COALESCE(MAX(sort_order) + 1, 0) AS next FROM sys_scratchpad_categories`,
        )
        .get() as { next: number };

      const inserted = this.db
        .prepare(
          `INSERT INTO sys_scratchpad_categories (name, sort_order, created_at)
           VALUES (?, ?, datetime('now'))`,
        )
        .run(name, next);

      const row = this.db
        .prepare(
          `SELECT id, name, sort_order, created_at
           FROM sys_scratchpad_categories WHERE id = ?`,
        )
        .get(Number(inserted.lastInsertRowid)) as CategoryRow | undefined;

      if (!row) throw new Error("Failed to read back the category just created.");
      return toCategory(row);
    });

    return write();
  }

  rename(id: number, name: string): NoteCategory | undefined {
    this.db
      .prepare(`UPDATE sys_scratchpad_categories SET name = ? WHERE id = ?`)
      .run(name, id);
    // Read back rather than trusting the update's row count, so the caller gets the
    // stored row — including the capitalisation as actually written.
    return this.findById(id);
  }

  reorder(ids: readonly number[]): NoteCategory[] {
    // One transaction for the whole strip: a crash midway would otherwise leave two
    // categories claiming the same position, which `list`'s tiebreaker would paper over
    // in an order nobody chose.
    const write = this.db.transaction(() => {
      const update = this.db.prepare(
        `UPDATE sys_scratchpad_categories SET sort_order = ? WHERE id = ?`,
      );
      // A missing id simply updates no rows — the "ignored rather than throwing"
      // contract the port documents, so a stale admin screen can still reorder the
      // categories that do exist.
      ids.forEach((id, index) => update.run(index, id));
    });

    write();
    return this.list();
  }

  delete(id: number): void {
    // No cascade, deliberately — see `deleteCategory`, which refuses while notes exist.
    // A `DELETE` here that also removed notes would make that guard bypassable.
    this.db.prepare(`DELETE FROM sys_scratchpad_categories WHERE id = ?`).run(id);
  }

  count(): number {
    const { total } = this.db
      .prepare(`SELECT COUNT(*) AS total FROM sys_scratchpad_categories`)
      .get() as { total: number };
    return total;
  }

  countNotes(id: number): { noteCount: number; ownerCount: number } {
    // The module's one household-wide read, and it returns nothing but numbers. There is
    // deliberately no sibling method that selects a note's text or an owner's name, so
    // an admin screen cannot grow into a window onto other people's notebooks.
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS note_count, COUNT(DISTINCT user_id) AS owner_count
         FROM sys_scratchpad_notes WHERE category_id = ?`,
      )
      .get(id) as { note_count: number; owner_count: number };
    return { noteCount: row.note_count, ownerCount: row.owner_count };
  }
}

/**
 * The notes — the other file that knows SQL.
 *
 * **Every statement is scoped by `user_id`.** A note is private working-out rather than
 * a shared board like `gam_scores`, so the owner is part of every query's identity and
 * there is no method that reads across users. That is what makes a note id arriving from
 * a client safe to act on: a note belonging to someone else is simply not found.
 */
export class SqliteScratchpadRepository implements ScratchpadRepository {
  constructor(private readonly db: Database.Database) {}

  listByCategory(userId: number, categoryId: number): Note[] {
    // `updated_at DESC, id DESC` — the tiebreaker is not optional. `datetime('now')`
    // has one-second resolution, so two notes saved in the same second would otherwise
    // come back in an arbitrary order and the list would appear to shuffle itself while
    // someone was typing. Matches `idx_sys_scratchpad_notes_recent`.
    const rows = this.db
      .prepare(
        `SELECT id, user_id, category_id, title, body, created_at, updated_at
         FROM sys_scratchpad_notes
         WHERE user_id = ? AND category_id = ?
         ORDER BY updated_at DESC, id DESC`,
      )
      .all(userId, categoryId) as NoteRow[];
    return rows.map(toNote);
  }

  findById(userId: number, id: number): Note | undefined {
    const row = this.db
      .prepare(
        `SELECT id, user_id, category_id, title, body, created_at, updated_at
         FROM sys_scratchpad_notes
         WHERE user_id = ? AND id = ?`,
      )
      .get(userId, id) as NoteRow | undefined;
    return row ? toNote(row) : undefined;
  }

  countInCategory(userId: number, categoryId: number): number {
    const { total } = this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM sys_scratchpad_notes
         WHERE user_id = ? AND category_id = ?`,
      )
      .get(userId, categoryId) as { total: number };
    return total;
  }

  create(userId: number, categoryId: number, title: string, body: string): Note {
    const inserted = this.db
      .prepare(
        `INSERT INTO sys_scratchpad_notes
           (user_id, category_id, title, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      )
      .run(userId, categoryId, title, body);

    const note = this.findById(userId, Number(inserted.lastInsertRowid));
    // Inserted on this connection a moment ago, so it cannot miss — checked rather than
    // asserted away, since a non-null assertion would turn a future change in the
    // SELECT into a confusing crash.
    if (!note) throw new Error("Failed to read back the note just created.");
    return note;
  }

  update(userId: number, id: number, fields: { title?: string; body?: string }): Note | undefined {
    // Built from the fields actually supplied, so an omitted one is left alone rather
    // than blanked. That is what lets an autosave write a body without clobbering a
    // title the reader set a moment earlier — and why this isn't one fixed statement
    // with `COALESCE`, which couldn't tell "not supplied" from "set to empty".
    const assignments: string[] = [];
    const values: (string | number)[] = [];

    if (fields.title !== undefined) {
      assignments.push("title = ?");
      values.push(fields.title);
    }
    if (fields.body !== undefined) {
      assignments.push("body = ?");
      values.push(fields.body);
    }

    // `updated_at` always moves, even when neither field was supplied: the list is
    // ordered by it, and a save is a save.
    assignments.push("updated_at = datetime('now')");

    const result = this.db
      .prepare(
        `UPDATE sys_scratchpad_notes SET ${assignments.join(", ")}
         WHERE user_id = ? AND id = ?`,
      )
      .run(...values, userId, id);

    // A zero row count means the note isn't this user's (or is gone). Returning
    // `undefined` rather than reading back lets the use-case report a miss instead of
    // reporting success for a write that never happened.
    if (result.changes === 0) return undefined;
    return this.findById(userId, id);
  }

  delete(userId: number, id: number): boolean {
    const result = this.db
      .prepare(`DELETE FROM sys_scratchpad_notes WHERE user_id = ? AND id = ?`)
      .run(userId, id);
    return result.changes > 0;
  }
}
