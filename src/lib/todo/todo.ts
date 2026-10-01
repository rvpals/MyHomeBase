import type { TodoCategoryRepository, TodoItemRepository } from "./ports";
import {
  ITEMS_PER_CATEGORY_LIMIT,
  createItemSchema,
  deleteItemSchema,
  listBoardSchema,
  reorderItemsSchema,
  setItemDoneSchema,
  updateItemSchema,
} from "./schema";
import type { TodoBoard, TodoCategoryBoard, TodoItem } from "./types";

/** The two repositories every board read needs, passed as one object. */
export interface TodoDeps {
  categoryRepo: TodoCategoryRepository;
  itemRepo: TodoItemRepository;
}

/**
 * Splits one list's items into the two halves the screen draws.
 *
 * A pure function over an already-ordered array, so it is the piece worth testing
 * directly: it asserts the *relative* order the repository returned survives the split,
 * which is the property a `filter` gets for free and a sort here would quietly break.
 *
 * The two halves are ordered differently on purpose (`TodoCategoryBoard`), and that
 * ordering is the repository's — both orders have an index behind them, so re-sorting
 * here would throw away the work the database already did and risk disagreeing with it.
 */
export function splitItems(items: readonly TodoItem[]): { open: TodoItem[]; completed: TodoItem[] } {
  return {
    open: items.filter((item) => !item.isDone),
    completed: items.filter((item) => item.isDone),
  };
}

/**
 * The whole board: every list with its items, ready to render.
 *
 * **Every list appears, even an empty one.** An empty list still draws its card, its tab
 * and its zero count — hiding it would leave nowhere to add the first item, the same
 * call `hasContent.myShortcuts` makes on the home screen.
 *
 * One read of each table rather than one read per list: the screen draws every card at
 * once, so a per-category query would be N+1 round trips to render a panel that always
 * wants all of them. `listBoardSchema`'s optional `categoryId` narrows it afterwards for
 * the CLI's single-list path — narrowing in memory rather than in SQL because the
 * expensive case is the one the screen uses, and that one wants everything.
 */
export function buildTodoBoard(deps: TodoDeps, input: { categoryId?: number } = {}): TodoBoard {
  const validated = listBoardSchema.parse(input);

  const categories = deps.categoryRepo
    .list()
    .filter((category) => validated.categoryId === undefined || category.id === validated.categoryId);

  const itemsByCategory = new Map<number, TodoItem[]>();
  for (const item of deps.itemRepo.listAll()) {
    const bucket = itemsByCategory.get(item.categoryId);
    if (bucket) bucket.push(item);
    else itemsByCategory.set(item.categoryId, [item]);
  }

  const boards: TodoCategoryBoard[] = categories.map((category) => ({
    category,
    ...splitItems(itemsByCategory.get(category.id) ?? []),
  }));

  return { categories: boards };
}

/**
 * Adds an item to a list.
 *
 * Both failures are ordinary and return a message: the list is gone (a stale screen), or
 * it is full. The cap refuses the create rather than pruning the oldest item — see
 * `ITEMS_PER_CATEGORY_LIMIT`.
 *
 * `createdBy` is attribution, not ownership. It is recorded and never read back as a
 * permission; anyone granted the module can act on any item.
 */
export function createItem(
  deps: TodoDeps,
  input: { categoryId: number; title: string; notes?: string },
  createdBy?: number,
): { ok: true; item: TodoItem } | { ok: false; message: string } {
  const validated = createItemSchema.parse(input);

  if (!deps.categoryRepo.findById(validated.categoryId)) {
    return { ok: false, message: "That list no longer exists." };
  }

  if (deps.itemRepo.countInCategory(validated.categoryId) >= ITEMS_PER_CATEGORY_LIMIT) {
    return {
      ok: false,
      message: `A list can hold at most ${ITEMS_PER_CATEGORY_LIMIT} items. Clear some completed ones first.`,
    };
  }

  return {
    ok: true,
    item: deps.itemRepo.create(validated.categoryId, validated.title, validated.notes, createdBy),
  };
}

/**
 * Edits an item's text.
 *
 * An omitted field is left alone rather than blanked, which is what lets a title be
 * corrected without touching a note. A missing id is a message, not a throw — the item
 * may have been deleted by someone else since the screen rendered, and on a shared list
 * that is an ordinary race rather than an error.
 */
export function updateItem(
  deps: TodoDeps,
  input: { id: number; title?: string; notes?: string },
): { ok: true; item: TodoItem } | { ok: false; message: string } {
  const validated = updateItemSchema.parse(input);

  const item = deps.itemRepo.update(validated.id, {
    title: validated.title,
    notes: validated.notes,
  });
  if (!item) return { ok: false, message: "That item no longer exists." };

  return { ok: true, item };
}

/**
 * Ticks or un-ticks an item.
 *
 * Idempotent by construction: the caller says which state it wants, so ticking an
 * already-ticked item is a no-op rather than a flip. That is what makes the checkbox
 * safe on a shared list, where two people can click the same row at once — see
 * `setItemDoneSchema`.
 *
 * The `doneAt` stamp is the repository's, because it is the clock's.
 */
export function setItemDone(
  deps: TodoDeps,
  input: { id: number; isDone: boolean },
): { ok: true; item: TodoItem } | { ok: false; message: string } {
  const validated = setItemDoneSchema.parse(input);

  const item = deps.itemRepo.setDone(validated.id, validated.isDone);
  if (!item) return { ok: false, message: "That item no longer exists." };

  return { ok: true, item };
}

/**
 * Deletes one item — the hover ✕ in the Completed group.
 *
 * Deleting an *open* item is allowed too, and deliberately: "never mind, we don't need
 * milk" is as ordinary as finishing something, and forcing someone to tick a thing they
 * never did to get rid of it would make the completed list a lie.
 */
export function deleteItem(
  deps: TodoDeps,
  input: { id: number },
): { ok: true } | { ok: false; message: string } {
  const validated = deleteItemSchema.parse(input);

  if (!deps.itemRepo.delete(validated.id)) {
    return { ok: false, message: "That item no longer exists." };
  }

  return { ok: true };
}

/** Rearranges the open items within one list. Unknown ids are ignored, as with lists. */
export function reorderItems(
  deps: TodoDeps,
  input: { categoryId: number; ids: readonly number[] },
): { ok: true; items: TodoItem[] } | { ok: false; message: string } {
  const validated = reorderItemsSchema.parse(input);

  if (!deps.categoryRepo.findById(validated.categoryId)) {
    return { ok: false, message: "That list no longer exists." };
  }

  return { ok: true, items: deps.itemRepo.reorder(validated.categoryId, validated.ids) };
}

/**
 * Clears every completed item from one list.
 *
 * Exists because the alternative is clicking ✕ 146 times, and because `deleteCategory`
 * refuses while anything is filed under a list — without this, emptying a finished list
 * to remove it is unreasonable by hand.
 *
 * Only the completed half, never the open one: a single control that could wipe
 * outstanding commitments is not one to put next to a list people share.
 */
export function clearCompleted(
  deps: TodoDeps,
  input: { categoryId: number },
): { ok: true; removed: number } | { ok: false; message: string } {
  const { categoryId } = reorderItemsSchema
    .pick({ categoryId: true })
    .parse({ categoryId: input.categoryId });

  if (!deps.categoryRepo.findById(categoryId)) {
    return { ok: false, message: "That list no longer exists." };
  }

  const completed = deps.itemRepo.listByCategory(categoryId).filter((item) => item.isDone);
  for (const item of completed) deps.itemRepo.delete(item.id);

  return { ok: true, removed: completed.length };
}
