import type { NoteCategoryRepository, ScratchpadRepository } from "./ports";
import type { Note, NoteCategory } from "./types";

/**
 * In-memory fakes for the two ports, shared by this module's tests.
 *
 * Hand-written rather than a mocking framework, per ARCHITECTURE.md: readable, reusable
 * across the module's test files, and not coupled to call order. Each reproduces the
 * behaviours the real repository is responsible for — the ordering, the case-insensitive
 * name check, the per-user scoping — so a use-case test exercises the same contract the
 * SQL implements.
 *
 * In `src/lib/` rather than a `__fixtures__` folder because three test files need them
 * and the alternative was copying 80 lines twice. It ships no production code path: the
 * barrel deliberately does not export these, so nothing outside the module's own tests
 * can reach them.
 */

/** A fixed clock, so `updatedAt` ordering is asserted rather than raced. */
let tick = 0;
function nextTimestamp(): string {
  tick += 1;
  // Monotonic and ISO-shaped. Seconds increment so two saves are distinguishable —
  // which is the one thing the real `datetime('now')` cannot promise, and why the SQL
  // carries an `id` tiebreaker the fakes mirror below.
  return `2026-09-15T12:00:${String(tick).padStart(2, "0")}Z`;
}

/** Resets the fake clock. Call in `beforeEach` when a test asserts on timestamps. */
export function resetFakeClock(): void {
  tick = 0;
}

export class FakeNoteCategoryRepository implements NoteCategoryRepository {
  private rows: NoteCategory[] = [];
  private nextId = 1;
  /** Note counts by category id, set by a test to exercise the delete guard. */
  private noteCounts = new Map<number, { noteCount: number; ownerCount: number }>();

  constructor(names: readonly string[] = []) {
    for (const name of names) this.create(name);
  }

  /** Seeds the counts `countNotes` reports, standing in for the notes table. */
  setNoteCount(categoryId: number, noteCount: number, ownerCount = 1): void {
    this.noteCounts.set(categoryId, { noteCount, ownerCount });
  }

  list(): NoteCategory[] {
    // `(sortOrder, id)`, exactly as the SQL orders — so a tie falls back to insertion
    // order here too and the tests see the stable strip the window sees.
    return [...this.rows].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  }

  findById(id: number): NoteCategory | undefined {
    return this.rows.find((row) => row.id === id);
  }

  isNameTaken(name: string, exceptId?: number): boolean {
    const target = name.toLowerCase();
    return this.rows.some(
      (row) => row.name.toLowerCase() === target && row.id !== exceptId,
    );
  }

  create(name: string): NoteCategory {
    // `MAX(sortOrder) + 1`, as the SQL does — deletes leave gaps, so a count would hand
    // a new category a position an existing one already holds.
    const next = this.rows.reduce((max, row) => Math.max(max, row.sortOrder + 1), 0);
    const category: NoteCategory = {
      id: this.nextId,
      name,
      sortOrder: next,
      createdAt: nextTimestamp(),
    };
    this.nextId += 1;
    this.rows.push(category);
    return category;
  }

  rename(id: number, name: string): NoteCategory | undefined {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row) return undefined;
    row.name = name;
    return row;
  }

  reorder(ids: readonly number[]): NoteCategory[] {
    // A missing id updates nothing, per the port's contract.
    ids.forEach((id, index) => {
      const row = this.rows.find((candidate) => candidate.id === id);
      if (row) row.sortOrder = index;
    });
    return this.list();
  }

  delete(id: number): void {
    // No cascade — the guard in `deleteCategory` is what stops a non-empty delete, and
    // a fake that cascaded would hide a use-case that forgot to check.
    this.rows = this.rows.filter((row) => row.id !== id);
  }

  count(): number {
    return this.rows.length;
  }

  countNotes(id: number): { noteCount: number; ownerCount: number } {
    return this.noteCounts.get(id) ?? { noteCount: 0, ownerCount: 0 };
  }
}

export class FakeScratchpadRepository implements ScratchpadRepository {
  private rows: Note[] = [];
  private nextId = 1;

  listByCategory(userId: number, categoryId: number): Note[] {
    return this.rows
      .filter((row) => row.userId === userId && row.categoryId === categoryId)
      // Newest-edited first, with the same `id` tiebreaker the index carries.
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id);
  }

  findById(userId: number, id: number): Note | undefined {
    // Scoped by user, like every statement in the real repository: someone else's note
    // is simply not found, which is the invariant the use-cases rely on.
    return this.rows.find((row) => row.userId === userId && row.id === id);
  }

  countInCategory(userId: number, categoryId: number): number {
    return this.rows.filter((row) => row.userId === userId && row.categoryId === categoryId)
      .length;
  }

  create(userId: number, categoryId: number, title: string, body: string): Note {
    const now = nextTimestamp();
    const note: Note = {
      id: this.nextId,
      userId,
      categoryId,
      title,
      body,
      createdAt: now,
      updatedAt: now,
    };
    this.nextId += 1;
    this.rows.push(note);
    return note;
  }

  update(userId: number, id: number, fields: { title?: string; body?: string }): Note | undefined {
    const row = this.findById(userId, id);
    if (!row) return undefined;
    // An omitted field is left alone, not blanked — the behaviour that lets a body
    // autosave run without clobbering a title.
    if (fields.title !== undefined) row.title = fields.title;
    if (fields.body !== undefined) row.body = fields.body;
    row.updatedAt = nextTimestamp();
    return row;
  }

  delete(userId: number, id: number): boolean {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !(row.userId === userId && row.id === id));
    return this.rows.length < before;
  }
}
