import type { TodoCategoryRepository, TodoItemRepository } from "./ports";
import type { TodoCategory, TodoItem } from "./types";

/**
 * In-memory fakes for the two ports, shared by this module's tests.
 *
 * Hand-written rather than a mocking framework, per ARCHITECTURE.md: readable, reusable
 * across the module's test files, and not coupled to call order. Each reproduces the
 * behaviours the real repository is responsible for — the two orderings, the
 * case-insensitive name check, the `doneAt` stamp — so a use-case test exercises the
 * same contract the SQL implements.
 *
 * Ships no production code path: the barrel deliberately does not export these, so
 * nothing outside the module's own tests can reach them.
 */

/** A fixed clock, so `doneAt` ordering is asserted rather than raced. */
let tick = 0;
function nextTimestamp(): string {
  tick += 1;
  // Monotonic and ISO-shaped. Seconds increment so two ticks are distinguishable —
  // the one thing the real `datetime('now')` cannot promise, and why both the SQL and
  // the fake carry an `id` tiebreaker.
  return `2026-09-30T12:00:${String(tick).padStart(2, "0")}Z`;
}

/** Resets the fake clock. Call in `beforeEach` when a test asserts on timestamps. */
export function resetFakeClock(): void {
  tick = 0;
}

export class FakeTodoCategoryRepository implements TodoCategoryRepository {
  private rows: TodoCategory[] = [];
  private nextId = 1;

  constructor(names: readonly string[] = []) {
    for (const name of names) this.create(name);
  }

  list(): TodoCategory[] {
    // `(sortOrder, id)`, exactly as the SQL orders — so a tie falls back to insertion
    // order rather than being arbitrary.
    return [...this.rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }

  findById(id: number): TodoCategory | undefined {
    return this.rows.find((row) => row.id === id);
  }

  isNameTaken(name: string, exceptId?: number): boolean {
    const wanted = name.toLowerCase();
    return this.rows.some((row) => row.id !== exceptId && row.name.toLowerCase() === wanted);
  }

  create(name: string): TodoCategory {
    const row: TodoCategory = {
      id: this.nextId++,
      name,
      // Appended at the end, like the real `MAX(sort_order) + 1`.
      sortOrder: this.rows.length,
      createdAt: nextTimestamp(),
    };
    this.rows.push(row);
    return row;
  }

  rename(id: number, name: string): TodoCategory | undefined {
    const row = this.findById(id);
    if (!row) return undefined;
    row.name = name;
    return row;
  }

  reorder(ids: readonly number[]): TodoCategory[] {
    // Ids that no longer exist are skipped rather than throwing — the behaviour the
    // port documents, and what lets a stale screen reorder the rows that remain.
    ids.forEach((id, index) => {
      const row = this.findById(id);
      if (row) row.sortOrder = index;
    });
    return this.list();
  }

  delete(id: number): void {
    this.rows = this.rows.filter((row) => row.id !== id);
  }

  count(): number {
    return this.rows.length;
  }
}

export class FakeTodoItemRepository implements TodoItemRepository {
  private rows: TodoItem[] = [];
  private nextId = 1;

  /** Orders one category's rows the way the two indexes do. */
  private ordered(rows: readonly TodoItem[]): TodoItem[] {
    const open = rows
      .filter((row) => !row.isDone)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    const completed = rows
      .filter((row) => row.isDone)
      // `doneAt DESC, id DESC` — newest completion first, with the id breaking a tie
      // monotonically, mirroring `idx_tol_todo_items_done`.
      .sort((a, b) => (b.doneAt ?? "").localeCompare(a.doneAt ?? "") || b.id - a.id);
    return [...open, ...completed];
  }

  listByCategory(categoryId: number): TodoItem[] {
    return this.ordered(this.rows.filter((row) => row.categoryId === categoryId));
  }

  listAll(): TodoItem[] {
    // Grouped by category and ordered within each, which is what the real query's
    // `ORDER BY category_id, …` produces and what `buildTodoBoard` buckets.
    const categoryIds = [...new Set(this.rows.map((row) => row.categoryId))].sort((a, b) => a - b);
    return categoryIds.flatMap((id) => this.listByCategory(id));
  }

  findById(id: number): TodoItem | undefined {
    return this.rows.find((row) => row.id === id);
  }

  countInCategory(categoryId: number): number {
    return this.rows.filter((row) => row.categoryId === categoryId).length;
  }

  countsForCategory(categoryId: number): { open: number; completed: number } {
    const mine = this.rows.filter((row) => row.categoryId === categoryId);
    return {
      open: mine.filter((row) => !row.isDone).length,
      completed: mine.filter((row) => row.isDone).length,
    };
  }

  create(categoryId: number, title: string, notes: string, createdBy?: number): TodoItem {
    const row: TodoItem = {
      id: this.nextId++,
      categoryId,
      title,
      notes,
      isDone: false,
      sortOrder: this.countInCategory(categoryId),
      createdBy,
      createdAt: nextTimestamp(),
    };
    this.rows.push(row);
    return row;
  }

  update(id: number, fields: { title?: string; notes?: string }): TodoItem | undefined {
    const row = this.findById(id);
    if (!row) return undefined;
    // An omitted key leaves the stored value alone — the behaviour `updateItemSchema`
    // depends on, and the one a naive `row.title = fields.title` would break.
    if (fields.title !== undefined) row.title = fields.title;
    if (fields.notes !== undefined) row.notes = fields.notes;
    return row;
  }

  setDone(id: number, isDone: boolean): TodoItem | undefined {
    const row = this.findById(id);
    if (!row) return undefined;
    row.isDone = isDone;
    // Stamped on the way in, cleared on the way out — so an un-ticked item can never
    // keep a timestamp claiming a completion that was undone.
    row.doneAt = isDone ? nextTimestamp() : undefined;
    return row;
  }

  delete(id: number): boolean {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => row.id !== id);
    return this.rows.length !== before;
  }

  reorder(categoryId: number, ids: readonly number[]): TodoItem[] {
    ids.forEach((id, index) => {
      const row = this.findById(id);
      if (row && row.categoryId === categoryId) row.sortOrder = index;
    });
    return this.listByCategory(categoryId);
  }
}
