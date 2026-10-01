import type Database from "better-sqlite3";
import type { TodoCategoryRepository, TodoItemRepository } from "./ports";
import type { TodoCategory, TodoItem } from "./types";

interface CategoryRow {
  id: number;
  name: string;
  sort_order: number;
  created_at: string;
}

interface ItemRow {
  id: number;
  category_id: number;
  title: string;
  notes: string;
  is_done: number;
  done_at: string | null;
  sort_order: number;
  created_by: number | null;
  created_at: string;
}

/** Rows to domain types — a repository never hands a caller a raw row. */
function toCategory(row: CategoryRow): TodoCategory {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

function toItem(row: ItemRow): TodoItem {
  return {
    id: row.id,
    categoryId: row.category_id,
    title: row.title,
    notes: row.notes,
    // SQLite has no boolean; the column is 0/1 and the domain type is a boolean, so the
    // conversion happens here rather than leaking an integer to every caller.
    isDone: row.is_done !== 0,
    // NULL becomes `undefined`, not `null` — the domain type has one kind of nothing.
    doneAt: row.done_at ?? undefined,
    sortOrder: row.sort_order,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
  };
}

const CATEGORY_COLUMNS = `id, name, sort_order, created_at`;
const ITEM_COLUMNS = `id, category_id, title, notes, is_done, done_at, sort_order, created_by, created_at`;

/**
 * Ordering for one list's items, shared by every read that returns them.
 *
 * The two halves sort by different columns, which is the whole reason this is a constant
 * rather than retyped per query: `is_done ASC` puts the open ones first, then open rows
 * order by their arrangement and completed rows by when they were ticked, newest first.
 *
 * Both tiebreakers are load-bearing. `sort_order` ties are the ordinary case (every item
 * starts at the same default), and `datetime('now')` has one-second resolution so two
 * quick ticks stamp identically — without the id, tied rows come back in an arbitrary
 * order and the list appears to shuffle between renders. Migration 0123 records this.
 */
const ITEM_ORDER = `ORDER BY is_done ASC, sort_order ASC, done_at DESC, id ASC`;

/**
 * The lists — one of the two classes here that knows SQL.
 *
 * **Nothing is scoped by user**, and neither is `SqliteTodoItemRepository` below. Unlike
 * the Scratchpad, whose notes are private, every row here belongs to the household:
 * access to the Tools module is the only gate. See migration 0123.
 */
export class SqliteTodoCategoryRepository implements TodoCategoryRepository {
  constructor(private readonly db: Database.Database) {}

  list(): TodoCategory[] {
    // `(sort_order, id)`, not `sort_order` alone: positions can tie (a reorder that
    // dropped a stale id, or the seeded rows before anyone rearranges them), and a tie
    // broken by insertion order is stable where an unordered tie is not — a panel that
    // reshuffles between page loads looks broken.
    const rows = this.db
      .prepare(
        `SELECT ${CATEGORY_COLUMNS} FROM tol_todo_categories
         ORDER BY sort_order ASC, id ASC`,
      )
      .all() as CategoryRow[];
    return rows.map(toCategory);
  }

  findById(id: number): TodoCategory | undefined {
    const row = this.db
      .prepare(`SELECT ${CATEGORY_COLUMNS} FROM tol_todo_categories WHERE id = ?`)
      .get(id) as CategoryRow | undefined;
    return row ? toCategory(row) : undefined;
  }

  isNameTaken(name: string, exceptId?: number): boolean {
    // `COLLATE NOCASE` matches the unique index, so this check and the constraint agree
    // — a near-duplicate is reported as a sentence here rather than surfacing as a
    // constraint error from the insert.
    const row = this.db
      .prepare(
        `SELECT 1 FROM tol_todo_categories
         WHERE name = ? COLLATE NOCASE AND id IS NOT ?
         LIMIT 1`,
      )
      .get(name, exceptId ?? null);
    return row !== undefined;
  }

  create(name: string): TodoCategory {
    // Appended at the end of the panel. `COALESCE` because `MAX` over an empty table is
    // NULL, which would make the first list's position NULL rather than 0.
    const info = this.db
      .prepare(
        `INSERT INTO tol_todo_categories (name, sort_order)
         VALUES (?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tol_todo_categories))`,
      )
      .run(name);
    // Read back rather than assembled in memory, so the caller gets the stored row —
    // including the database's own `created_at` default.
    return this.findById(Number(info.lastInsertRowid))!;
  }

  rename(id: number, name: string): TodoCategory | undefined {
    this.db.prepare(`UPDATE tol_todo_categories SET name = ? WHERE id = ?`).run(name, id);
    return this.findById(id);
  }

  reorder(ids: readonly number[]): TodoCategory[] {
    const update = this.db.prepare(`UPDATE tol_todo_categories SET sort_order = ? WHERE id = ?`);
    // One transaction, so the panel can never be left half-ordered by a failure
    // part-way through — the property `reorderCategoriesSchema` takes the whole list to
    // guarantee. An id that no longer exists updates nothing rather than throwing.
    this.db.transaction(() => {
      ids.forEach((id, index) => update.run(index, id));
    })();
    return this.list();
  }

  delete(id: number): void {
    // Not cascading, and the emptiness check is deliberately not here — it lives in
    // `deleteCategory`, where it can return a reason the screen renders. A repository
    // that deleted items too would make that guard bypassable.
    this.db.prepare(`DELETE FROM tol_todo_categories WHERE id = ?`).run(id);
  }

  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM tol_todo_categories`).get() as {
      n: number;
    };
    return row.n;
  }
}

/** The items. Shared, like the lists above — no user scoping anywhere. */
export class SqliteTodoItemRepository implements TodoItemRepository {
  constructor(private readonly db: Database.Database) {}

  listByCategory(categoryId: number): TodoItem[] {
    const rows = this.db
      .prepare(`SELECT ${ITEM_COLUMNS} FROM tol_todo_items WHERE category_id = ? ${ITEM_ORDER}`)
      .all(categoryId) as ItemRow[];
    return rows.map(toItem);
  }

  listAll(): TodoItem[] {
    // The board's one read of this table. Grouped by category so `buildTodoBoard` can
    // bucket in a single pass, and ordered within each group by the same rule as above —
    // one query rather than one per list, because the screen always draws every card.
    const rows = this.db
      .prepare(`SELECT ${ITEM_COLUMNS} FROM tol_todo_items ORDER BY category_id ASC, is_done ASC, sort_order ASC, done_at DESC, id ASC`)
      .all() as ItemRow[];
    return rows.map(toItem);
  }

  findById(id: number): TodoItem | undefined {
    const row = this.db
      .prepare(`SELECT ${ITEM_COLUMNS} FROM tol_todo_items WHERE id = ?`)
      .get(id) as ItemRow | undefined;
    return row ? toItem(row) : undefined;
  }

  countInCategory(categoryId: number): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM tol_todo_items WHERE category_id = ?`)
      .get(categoryId) as { n: number };
    return row.n;
  }

  countsForCategory(categoryId: number): { open: number; completed: number } {
    // Both halves in one query rather than two round trips — the side panel reads this
    // for every list on every render.
    const row = this.db
      .prepare(
        `SELECT
           SUM(CASE WHEN is_done = 0 THEN 1 ELSE 0 END) AS open_count,
           SUM(CASE WHEN is_done = 1 THEN 1 ELSE 0 END) AS done_count
         FROM tol_todo_items WHERE category_id = ?`,
      )
      .get(categoryId) as { open_count: number | null; done_count: number | null };
    // `SUM` over no rows is NULL, not 0 — an empty list must report zeroes, not NaN.
    return { open: row.open_count ?? 0, completed: row.done_count ?? 0 };
  }

  create(categoryId: number, title: string, notes: string, createdBy?: number): TodoItem {
    const info = this.db
      .prepare(
        `INSERT INTO tol_todo_items (category_id, title, notes, created_by, sort_order)
         VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tol_todo_items WHERE category_id = ?))`,
      )
      .run(categoryId, title, notes, createdBy ?? null, categoryId);
    return this.findById(Number(info.lastInsertRowid))!;
  }

  update(id: number, fields: { title?: string; notes?: string }): TodoItem | undefined {
    // `COALESCE(?, column)` leaves an omitted field alone in one statement, rather than
    // building a dynamic SET clause. `undefined` has to become `null` for the driver,
    // and `null` is what COALESCE falls through on — which works precisely because
    // neither column is nullable, so a real value can never be confused with "absent".
    this.db
      .prepare(
        `UPDATE tol_todo_items
         SET title = COALESCE(?, title), notes = COALESCE(?, notes)
         WHERE id = ?`,
      )
      .run(fields.title ?? null, fields.notes ?? null, id);
    return this.findById(id);
  }

  setDone(id: number, isDone: boolean): TodoItem | undefined {
    // The stamp and the flag are written together, so the Completed group can never sort
    // on a timestamp belonging to an item that is open. Un-ticking clears it rather than
    // leaving a stale completion behind.
    this.db
      .prepare(
        `UPDATE tol_todo_items
         SET is_done = ?, done_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END
         WHERE id = ?`,
      )
      .run(isDone ? 1 : 0, isDone ? 1 : 0, id);
    return this.findById(id);
  }

  delete(id: number): boolean {
    const info = this.db.prepare(`DELETE FROM tol_todo_items WHERE id = ?`).run(id);
    return info.changes > 0;
  }

  reorder(categoryId: number, ids: readonly number[]): TodoItem[] {
    // `AND category_id = ?` is the guard that stops a posted id moving an item that
    // belongs to a different list — the ids arrive from a client, and the use-case only
    // checked that the *category* exists.
    const update = this.db.prepare(
      `UPDATE tol_todo_items SET sort_order = ? WHERE id = ? AND category_id = ?`,
    );
    this.db.transaction(() => {
      ids.forEach((id, index) => update.run(index, id, categoryId));
    })();
    return this.listByCategory(categoryId);
  }
}
