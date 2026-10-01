import type { TodoCategory, TodoItem } from "./types";

/**
 * What the list use-cases need from storage.
 *
 * Two ports rather than one, split along the line between *structure* and *content*:
 * the panel's lists and the items inside them. Keeping them apart means a use-case that
 * only arranges the panel cannot reach an item, and it is the same split
 * `src/lib/scratchpad/ports.ts` draws — though note that here **both** sides are shared,
 * so neither port is scoped by a user id. Migration 0123 explains why.
 */
export interface TodoCategoryRepository {
  /** Every list, ordered by `(sortOrder, id)` — the panel's and tab strip's order. */
  list(): TodoCategory[];
  /** One list, or `undefined`. The existence check the item use-cases need. */
  findById(id: number): TodoCategory | undefined;
  /**
   * Whether a name is taken, case-insensitively, ignoring `exceptId`.
   *
   * `exceptId` is what makes renaming a list to a different capitalisation of its own
   * name work ("work" → "Work") instead of colliding with itself.
   */
  isNameTaken(name: string, exceptId?: number): boolean;
  /** Appends a list at the end of the panel and returns it as stored. */
  create(name: string): TodoCategory;
  /** Renames one. Returns the stored row, or `undefined` if the id is gone. */
  rename(id: number, name: string): TodoCategory | undefined;
  /**
   * Writes the given ids' positions to match their order in the array.
   *
   * Takes the whole list so the panel can never be left half-reordered — see
   * `reorderCategoriesSchema`. Ids that no longer exist are ignored rather than
   * throwing, since a stale screen posting a deleted id should not fail the reorder of
   * the ones that remain.
   */
  reorder(ids: readonly number[]): TodoCategory[];
  /**
   * Deletes a list. The caller has already checked it is empty.
   *
   * Deliberately **not** cascading, and deliberately not checking emptiness itself: the
   * guard lives in `deleteCategory` where it can return a reason the screen renders, and
   * a repository that silently deleted items would make that guard bypassable.
   */
  delete(id: number): void;
  /** How many lists exist, for the cap. */
  count(): number;
}

/**
 * What the item use-cases need from storage.
 *
 * **No method is scoped by a user.** Every item is the household's, actionable by
 * anyone granted the Tools module — so unlike `ScratchpadRepository`, an id arriving
 * from a client is acted on once the module guard has passed, with no owner check
 * behind it. That is the access model migration 0123 settles, and it is why
 * `createdBy` is written but never read back as a permission.
 */
export interface TodoItemRepository {
  /**
   * One list's items, both halves, already ordered.
   *
   * Open items by `(sortOrder, id)`; completed by `(doneAt DESC, id DESC)`. The two
   * orders differ on purpose — see `TodoCategoryBoard` — and the repository applies them
   * because they are what the two indexes exist to serve.
   */
  listByCategory(categoryId: number): TodoItem[];
  /** Every item across every list, in the same per-list order. The board's one read. */
  listAll(): TodoItem[];
  /** One item, or `undefined`. */
  findById(id: number): TodoItem | undefined;
  /** How many items a list holds, both halves, for the cap. */
  countInCategory(categoryId: number): number;
  /**
   * How many items are filed under this list, for the delete guard and the panel count.
   *
   * Split into the two halves because the panel shows the **open** count beside each
   * list — the screenshot's `To DO List 15` — while the delete guard cares that
   * *anything* is there at all.
   */
  countsForCategory(categoryId: number): { open: number; completed: number };
  /** Appends an item to a list and returns it as stored. */
  create(categoryId: number, title: string, notes: string, createdBy?: number): TodoItem;
  /**
   * Writes the given fields, returning the stored item.
   *
   * An omitted field is left alone rather than blanked — see `updateItemSchema`.
   * Returns `undefined` when the id is gone, so the use-case reports a miss rather than
   * success for a write that never happened.
   */
  update(id: number, fields: { title?: string; notes?: string }): TodoItem | undefined;
  /**
   * Ticks or un-ticks an item, stamping or clearing `doneAt` to match.
   *
   * The stamp is the repository's because it is the clock's: a use-case that computed
   * `new Date()` would be untestable without freezing time, and the column has to agree
   * with `is_done` in the same write or the Completed group could sort on a timestamp
   * for an item that is open.
   */
  setDone(id: number, isDone: boolean): TodoItem | undefined;
  /** Deletes one item. Returns whether a row was actually removed. */
  delete(id: number): boolean;
  /** Writes the given ids' positions within one list, ignoring ids that are gone. */
  reorder(categoryId: number, ids: readonly number[]): TodoItem[];
}
