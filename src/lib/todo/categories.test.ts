import { beforeEach, describe, expect, it } from "vitest";
import {
  createCategory,
  deleteCategory,
  listCategories,
  renameCategory,
  reorderCategories,
} from "./categories";
import { FakeTodoCategoryRepository, FakeTodoItemRepository, resetFakeClock } from "./fakes";
import { CATEGORY_LIMIT } from "./schema";

beforeEach(() => {
  resetFakeClock();
});

describe("listCategories", () => {
  it("returns lists in (sortOrder, id) order, not insertion order", () => {
    const repo = new FakeTodoCategoryRepository(["To BUY", "Work TODO", "Learning"]);
    reorderCategories(repo, { ids: [3, 1, 2] });

    expect(listCategories(repo).map((c) => c.name)).toEqual(["Learning", "To BUY", "Work TODO"]);
  });

  it("is empty when nothing has been created", () => {
    expect(listCategories(new FakeTodoCategoryRepository())).toEqual([]);
  });
});

describe("createCategory", () => {
  it("appends a list at the end of the panel", () => {
    const repo = new FakeTodoCategoryRepository(["To BUY"]);

    const result = createCategory(repo, { name: "Learning" });

    expect(result.ok).toBe(true);
    expect(listCategories(repo).map((c) => c.name)).toEqual(["To BUY", "Learning"]);
  });

  it("trims the name before storing it", () => {
    const repo = new FakeTodoCategoryRepository();

    const result = createCategory(repo, { name: "  To BUY  " });

    expect(result).toMatchObject({ ok: true, category: { name: "To BUY" } });
  });

  it("refuses a duplicate name case-insensitively, and says so", () => {
    const repo = new FakeTodoCategoryRepository(["To BUY"]);

    const result = createCategory(repo, { name: "to buy" });

    expect(result).toEqual({ ok: false, message: 'There is already a list called "to buy".' });
    expect(repo.count()).toBe(1);
  });

  it("refuses a trailing-space duplicate — trimming happens before the check", () => {
    const repo = new FakeTodoCategoryRepository(["Work TODO"]);

    expect(createCategory(repo, { name: "Work TODO " }).ok).toBe(false);
  });

  it("refuses once the panel is full", () => {
    const repo = new FakeTodoCategoryRepository(
      Array.from({ length: CATEGORY_LIMIT }, (_, i) => `List ${i}`),
    );

    const result = createCategory(repo, { name: "One more" });

    expect(result).toEqual({
      ok: false,
      message: `There can be at most ${CATEGORY_LIMIT} lists.`,
    });
  });

  it("rejects a blank name", () => {
    expect(() => createCategory(new FakeTodoCategoryRepository(), { name: "   " })).toThrow();
  });

  it("rejects a multi-line name — a tab label is one line", () => {
    expect(() =>
      createCategory(new FakeTodoCategoryRepository(), { name: "To\nBUY" }),
    ).toThrow();
  });
});

describe("renameCategory", () => {
  it("renames a list", () => {
    const repo = new FakeTodoCategoryRepository(["To BUY"]);

    const result = renameCategory(repo, { id: 1, name: "Groceries" });

    expect(result).toMatchObject({ ok: true, category: { id: 1, name: "Groceries" } });
  });

  it("allows recapitalising a list to its own name", () => {
    // The `exceptId` case: without it this collides with itself and a capitalisation
    // could never be fixed, since deleting is refused while the list holds items.
    const repo = new FakeTodoCategoryRepository(["work todo"]);

    expect(renameCategory(repo, { id: 1, name: "Work TODO" })).toMatchObject({
      ok: true,
      category: { name: "Work TODO" },
    });
  });

  it("refuses a name another list already has", () => {
    const repo = new FakeTodoCategoryRepository(["To BUY", "Learning"]);

    const result = renameCategory(repo, { id: 2, name: "to buy" });

    expect(result).toEqual({ ok: false, message: 'There is already a list called "to buy".' });
  });

  it("reports a missing list rather than throwing", () => {
    const repo = new FakeTodoCategoryRepository(["To BUY"]);

    expect(renameCategory(repo, { id: 99, name: "Gone" })).toEqual({
      ok: false,
      message: "That list no longer exists.",
    });
  });
});

describe("reorderCategories", () => {
  it("applies the whole order in one write", () => {
    const repo = new FakeTodoCategoryRepository(["A", "B", "C"]);

    const result = reorderCategories(repo, { ids: [3, 2, 1] });

    expect(result.map((c) => c.name)).toEqual(["C", "B", "A"]);
  });

  it("ignores an id that no longer exists and still moves the rest", () => {
    // A stale screen posting a since-deleted id must not fail the reorder of the ones
    // that remain — the behaviour the port documents.
    const repo = new FakeTodoCategoryRepository(["A", "B"]);

    const result = reorderCategories(repo, { ids: [99, 2, 1] });

    expect(result.map((c) => c.name)).toEqual(["B", "A"]);
  });
});

describe("deleteCategory", () => {
  it("deletes an empty list", () => {
    const categories = new FakeTodoCategoryRepository(["To BUY"]);
    const items = new FakeTodoItemRepository();

    expect(deleteCategory(categories, items, { id: 1 })).toEqual({ ok: true });
    expect(categories.count()).toBe(0);
  });

  it("refuses while open items are filed under it, and names the counts", () => {
    const categories = new FakeTodoCategoryRepository(["To BUY"]);
    const items = new FakeTodoItemRepository();
    items.create(1, "Costco LR44 battery", "");
    items.create(1, "Listerine", "");

    const result = deleteCategory(categories, items, { id: 1 });

    expect(result).toEqual({
      ok: false,
      message: "That list still has 2 items in it (2 to do, 0 completed). Remove them first.",
    });
    expect(categories.count()).toBe(1);
  });

  it("refuses for completed items too — a finished list is still a record", () => {
    const categories = new FakeTodoCategoryRepository(["To BUY"]);
    const items = new FakeTodoItemRepository();
    const item = items.create(1, "Costco LR44 battery", "");
    items.setDone(item.id, true);

    expect(deleteCategory(categories, items, { id: 1 })).toEqual({
      ok: false,
      message: "That list still has 1 item in it (0 to do, 1 completed). Remove them first.",
    });
  });

  it("reports a missing list rather than throwing", () => {
    expect(
      deleteCategory(new FakeTodoCategoryRepository(), new FakeTodoItemRepository(), { id: 99 }),
    ).toEqual({ ok: false, message: "That list no longer exists." });
  });
});
