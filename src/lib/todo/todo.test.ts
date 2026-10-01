import { beforeEach, describe, expect, it } from "vitest";
import { FakeTodoCategoryRepository, FakeTodoItemRepository, resetFakeClock } from "./fakes";
import { ITEMS_PER_CATEGORY_LIMIT } from "./schema";
import {
  buildTodoBoard,
  clearCompleted,
  createItem,
  deleteItem,
  reorderItems,
  setItemDone,
  splitItems,
  updateItem,
  type TodoDeps,
} from "./todo";
import type { TodoItem } from "./types";

function makeDeps(names: readonly string[] = ["To BUY"]): TodoDeps & {
  categoryRepo: FakeTodoCategoryRepository;
  itemRepo: FakeTodoItemRepository;
} {
  return {
    categoryRepo: new FakeTodoCategoryRepository(names),
    itemRepo: new FakeTodoItemRepository(),
  };
}

beforeEach(() => {
  resetFakeClock();
});

describe("splitItems", () => {
  it("separates the two halves and preserves the given order within each", () => {
    // The property that matters: the repository already ordered these, so the split must
    // not re-sort. A `sort` here would silently disagree with the two SQL indexes.
    const items = [
      { id: 1, isDone: false },
      { id: 2, isDone: true },
      { id: 3, isDone: false },
      { id: 4, isDone: true },
    ] as TodoItem[];

    const { open, completed } = splitItems(items);

    expect(open.map((i) => i.id)).toEqual([1, 3]);
    expect(completed.map((i) => i.id)).toEqual([2, 4]);
  });

  it("handles a list with nothing in it", () => {
    expect(splitItems([])).toEqual({ open: [], completed: [] });
  });
});

describe("buildTodoBoard", () => {
  it("returns every list, including empty ones", () => {
    // An empty list still draws its card and its tab — hiding it would leave nowhere to
    // add the first item.
    const deps = makeDeps(["To BUY", "Learning"]);
    deps.itemRepo.create(1, "Costco LR44 battery", "");

    const board = buildTodoBoard(deps);

    expect(board.categories.map((c) => c.category.name)).toEqual(["To BUY", "Learning"]);
    expect(board.categories[1]).toMatchObject({ open: [], completed: [] });
  });

  it("splits each list into open and completed", () => {
    const deps = makeDeps();
    deps.itemRepo.create(1, "Open one", "");
    const done = deps.itemRepo.create(1, "Done one", "");
    deps.itemRepo.setDone(done.id, true);

    const board = buildTodoBoard(deps);

    expect(board.categories[0].open.map((i) => i.title)).toEqual(["Open one"]);
    expect(board.categories[0].completed.map((i) => i.title)).toEqual(["Done one"]);
  });

  it("orders completed items most recently ticked first", () => {
    const deps = makeDeps();
    const first = deps.itemRepo.create(1, "Ticked first", "");
    const second = deps.itemRepo.create(1, "Ticked second", "");
    deps.itemRepo.setDone(first.id, true);
    deps.itemRepo.setDone(second.id, true);

    const board = buildTodoBoard(deps);

    expect(board.categories[0].completed.map((i) => i.title)).toEqual([
      "Ticked second",
      "Ticked first",
    ]);
  });

  it("narrows to one list when given an id", () => {
    const deps = makeDeps(["To BUY", "Learning"]);

    const board = buildTodoBoard(deps, { categoryId: 2 });

    expect(board.categories).toHaveLength(1);
    expect(board.categories[0].category.name).toBe("Learning");
  });

  it("returns nothing for a list id that does not exist", () => {
    expect(buildTodoBoard(makeDeps(), { categoryId: 99 }).categories).toEqual([]);
  });
});

describe("createItem", () => {
  it("adds an item to a list", () => {
    const deps = makeDeps();

    const result = createItem(deps, { categoryId: 1, title: "Costco LR44 battery" });

    expect(result).toMatchObject({ ok: true, item: { title: "Costco LR44 battery", notes: "" } });
    expect(deps.itemRepo.countInCategory(1)).toBe(1);
  });

  it("records who added it without conferring ownership", () => {
    const deps = makeDeps();

    const result = createItem(deps, { categoryId: 1, title: "Pick up AML" }, 7);

    expect(result).toMatchObject({ ok: true, item: { createdBy: 7 } });
  });

  it("stores a detail line when one is given", () => {
    const deps = makeDeps();

    const result = createItem(deps, {
      categoryId: 1,
      title: "Instrument outputfile analysis",
      notes: "Complicated one: SpectraMax L (XML); PDF format (Raman)",
    });

    expect(result).toMatchObject({
      ok: true,
      item: { notes: "Complicated one: SpectraMax L (XML); PDF format (Raman)" },
    });
  });

  it("starts an item outstanding, with no completion timestamp", () => {
    const deps = makeDeps();

    const result = createItem(deps, { categoryId: 1, title: "New" });

    expect(result).toMatchObject({ ok: true, item: { isDone: false, doneAt: undefined } });
  });

  it("reports a missing list rather than orphaning the item", () => {
    const deps = makeDeps();

    expect(createItem(deps, { categoryId: 99, title: "Nowhere" })).toEqual({
      ok: false,
      message: "That list no longer exists.",
    });
    expect(deps.itemRepo.listAll()).toEqual([]);
  });

  it("refuses once the list is full rather than pruning the oldest", () => {
    const deps = makeDeps();
    for (let i = 0; i < ITEMS_PER_CATEGORY_LIMIT; i += 1) deps.itemRepo.create(1, `Item ${i}`, "");

    const result = createItem(deps, { categoryId: 1, title: "One more" });

    expect(result.ok).toBe(false);
    expect(deps.itemRepo.countInCategory(1)).toBe(ITEMS_PER_CATEGORY_LIMIT);
  });

  it("rejects a blank title", () => {
    expect(() => createItem(makeDeps(), { categoryId: 1, title: "   " })).toThrow();
  });
});

describe("updateItem", () => {
  it("edits a title", () => {
    const deps = makeDeps();
    deps.itemRepo.create(1, "Tylenol", "");

    expect(updateItem(deps, { id: 1, title: "7am Tylenol 1 tablet" })).toMatchObject({
      ok: true,
      item: { title: "7am Tylenol 1 tablet" },
    });
  });

  it("leaves an omitted field alone — editing a title must not blank the notes", () => {
    const deps = makeDeps();
    deps.itemRepo.create(1, "Instrument analysis", "SpectraMax L");

    const result = updateItem(deps, { id: 1, title: "Instrument outputfile analysis" });

    expect(result).toMatchObject({ ok: true, item: { notes: "SpectraMax L" } });
  });

  it("can clear the notes explicitly", () => {
    const deps = makeDeps();
    deps.itemRepo.create(1, "Item", "some detail");

    expect(updateItem(deps, { id: 1, notes: "" })).toMatchObject({ ok: true, item: { notes: "" } });
  });

  it("reports a missing item rather than throwing", () => {
    expect(updateItem(makeDeps(), { id: 99, title: "Gone" })).toEqual({
      ok: false,
      message: "That item no longer exists.",
    });
  });
});

describe("setItemDone", () => {
  it("ticks an item and stamps when it happened", () => {
    const deps = makeDeps();
    deps.itemRepo.create(1, "Costco LR44 battery", "");

    const result = setItemDone(deps, { id: 1, isDone: true });

    expect(result).toMatchObject({ ok: true, item: { isDone: true } });
    expect(result.ok && result.item.doneAt).toBeDefined();
  });

  it("keeps the item rather than deleting it — the Completed group needs it", () => {
    const deps = makeDeps();
    deps.itemRepo.create(1, "Costco LR44 battery", "");

    setItemDone(deps, { id: 1, isDone: true });

    expect(deps.itemRepo.countInCategory(1)).toBe(1);
  });

  it("clears the timestamp when un-ticked, so no undone completion is claimed", () => {
    const deps = makeDeps();
    deps.itemRepo.create(1, "Costco LR44 battery", "");
    setItemDone(deps, { id: 1, isDone: true });

    const result = setItemDone(deps, { id: 1, isDone: false });

    expect(result).toMatchObject({ ok: true, item: { isDone: false, doneAt: undefined } });
  });

  it("is idempotent — ticking an already-ticked item does not flip it back", () => {
    // The reason `isDone` is explicit rather than a toggle: two people can click the
    // same row at once on a shared list.
    const deps = makeDeps();
    deps.itemRepo.create(1, "Costco LR44 battery", "");
    setItemDone(deps, { id: 1, isDone: true });

    expect(setItemDone(deps, { id: 1, isDone: true })).toMatchObject({
      ok: true,
      item: { isDone: true },
    });
  });

  it("reports a missing item rather than throwing", () => {
    expect(setItemDone(makeDeps(), { id: 99, isDone: true })).toEqual({
      ok: false,
      message: "That item no longer exists.",
    });
  });
});

describe("deleteItem", () => {
  it("removes a completed item", () => {
    const deps = makeDeps();
    deps.itemRepo.create(1, "Costco LR44 battery", "");
    setItemDone(deps, { id: 1, isDone: true });

    expect(deleteItem(deps, { id: 1 })).toEqual({ ok: true });
    expect(deps.itemRepo.countInCategory(1)).toBe(0);
  });

  it("removes an open item too — 'never mind' is as ordinary as finishing", () => {
    const deps = makeDeps();
    deps.itemRepo.create(1, "Costco LR44 battery", "");

    expect(deleteItem(deps, { id: 1 })).toEqual({ ok: true });
  });

  it("reports a missing item rather than throwing", () => {
    expect(deleteItem(makeDeps(), { id: 99 })).toEqual({
      ok: false,
      message: "That item no longer exists.",
    });
  });
});

describe("reorderItems", () => {
  it("rearranges the open items in one write", () => {
    const deps = makeDeps();
    deps.itemRepo.create(1, "A", "");
    deps.itemRepo.create(1, "B", "");
    deps.itemRepo.create(1, "C", "");

    const result = reorderItems(deps, { categoryId: 1, ids: [3, 1, 2] });

    expect(result.ok && result.items.map((i) => i.title)).toEqual(["C", "A", "B"]);
  });

  it("reports a missing list rather than throwing", () => {
    expect(reorderItems(makeDeps(), { categoryId: 99, ids: [] })).toEqual({
      ok: false,
      message: "That list no longer exists.",
    });
  });
});

describe("clearCompleted", () => {
  it("removes every completed item and leaves the open ones", () => {
    const deps = makeDeps();
    deps.itemRepo.create(1, "Still to do", "");
    const done = deps.itemRepo.create(1, "Finished", "");
    deps.itemRepo.setDone(done.id, true);

    const result = clearCompleted(deps, { categoryId: 1 });

    expect(result).toEqual({ ok: true, removed: 1 });
    expect(deps.itemRepo.listByCategory(1).map((i) => i.title)).toEqual(["Still to do"]);
  });

  it("removes nothing from a list with no completed items", () => {
    const deps = makeDeps();
    deps.itemRepo.create(1, "Still to do", "");

    expect(clearCompleted(deps, { categoryId: 1 })).toEqual({ ok: true, removed: 0 });
    expect(deps.itemRepo.countInCategory(1)).toBe(1);
  });

  it("does not touch another list's completed items", () => {
    const deps = makeDeps(["To BUY", "Learning"]);
    const other = deps.itemRepo.create(2, "Other list, done", "");
    deps.itemRepo.setDone(other.id, true);

    clearCompleted(deps, { categoryId: 1 });

    expect(deps.itemRepo.countInCategory(2)).toBe(1);
  });

  it("reports a missing list rather than throwing", () => {
    expect(clearCompleted(makeDeps(), { categoryId: 99 })).toEqual({
      ok: false,
      message: "That list no longer exists.",
    });
  });
});
