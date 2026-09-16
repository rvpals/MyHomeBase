import { beforeEach, describe, expect, it } from "vitest";
import {
  createCategory,
  deleteCategory,
  describeDeleteRefusal,
  listCategories,
  renameCategory,
  reorderCategories,
} from "./categories";
import { FakeNoteCategoryRepository, resetFakeClock } from "./fakes";
import { CATEGORY_LIMIT } from "./schema";

beforeEach(() => resetFakeClock());

describe("listCategories", () => {
  it("returns the strip in the admin's order", () => {
    const repo = new FakeNoteCategoryRepository(["Ideas", "Shopping", "Work"]);
    expect(listCategories(repo).map((category) => category.name)).toEqual([
      "Ideas",
      "Shopping",
      "Work",
    ]);
  });
});

describe("createCategory", () => {
  it("appends a category to the end of the strip", () => {
    const repo = new FakeNoteCategoryRepository(["Ideas"]);

    const result = createCategory(repo, { name: "Shopping" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.category).toMatchObject({ name: "Shopping", sortOrder: 1 });
  });

  it("trims the name so a trailing space can't smuggle past the duplicate check", () => {
    const repo = new FakeNoteCategoryRepository(["Ideas"]);
    expect(createCategory(repo, { name: "  Shopping  " }).ok).toBe(true);
    expect(repo.list()[1]?.name).toBe("Shopping");
    expect(createCategory(repo, { name: "Shopping " }).ok).toBe(false);
  });

  it("rejects a duplicate name case-insensitively", () => {
    // Two tabs reading "Work" and "work" are indistinguishable at a glance, and a
    // reader would file notes into whichever they happened to hit.
    const repo = new FakeNoteCategoryRepository(["Work"]);

    const result = createCategory(repo, { name: "work" });

    expect(result).toEqual({
      ok: false,
      message: 'There is already a category called "work".',
    });
    expect(repo.count()).toBe(1);
  });

  it("refuses past the category cap", () => {
    const repo = new FakeNoteCategoryRepository(
      Array.from({ length: CATEGORY_LIMIT }, (_, index) => `Category ${index}`),
    );

    expect(createCategory(repo, { name: "One more" }).ok).toBe(false);
    expect(repo.count()).toBe(CATEGORY_LIMIT);
  });

  it("rejects a blank name and a multi-line name at the boundary", () => {
    const repo = new FakeNoteCategoryRepository();
    expect(() => createCategory(repo, { name: "   " })).toThrow();
    // A pasted multi-line string would render as a tab of unbounded height.
    expect(() => createCategory(repo, { name: "Work\nStuff" })).toThrow();
  });

  it("gives a new category a free position after a delete left a gap", () => {
    // `MAX(sort_order) + 1`, not a count: with a gap, a count would hand the new
    // category a position an existing one already holds.
    const repo = new FakeNoteCategoryRepository(["A", "B", "C"]);
    repo.delete(2);

    const result = createCategory(repo, { name: "D" });

    expect(result.ok && result.category.sortOrder).toBe(3);
    expect(listCategories(repo).map((category) => category.name)).toEqual(["A", "C", "D"]);
  });
});

describe("renameCategory", () => {
  it("renames a category", () => {
    const repo = new FakeNoteCategoryRepository(["Shoping"]);

    const result = renameCategory(repo, { id: 1, name: "Shopping" });

    expect(result.ok && result.category.name).toBe("Shopping");
  });

  it("allows recapitalising a category to its own name", () => {
    // Without `exceptId` this collides with itself, and the only way to fix a
    // capitalisation would be to delete the tab — which is refused while it holds
    // notes, so the admin would be stuck.
    const repo = new FakeNoteCategoryRepository(["work"]);

    const result = renameCategory(repo, { id: 1, name: "Work" });

    expect(result.ok && result.category.name).toBe("Work");
  });

  it("still rejects renaming onto another category's name", () => {
    const repo = new FakeNoteCategoryRepository(["Ideas", "Work"]);
    expect(renameCategory(repo, { id: 1, name: "work" }).ok).toBe(false);
    expect(repo.findById(1)?.name).toBe("Ideas");
  });

  it("reports a category that no longer exists", () => {
    expect(renameCategory(new FakeNoteCategoryRepository(), { id: 404, name: "X" })).toEqual({
      ok: false,
      message: "That category no longer exists.",
    });
  });
});

describe("reorderCategories", () => {
  it("rewrites the whole strip's order", () => {
    const repo = new FakeNoteCategoryRepository(["Ideas", "Shopping", "Work"]);

    const strip = reorderCategories(repo, { ids: [3, 1, 2] });

    expect(strip.map((category) => category.name)).toEqual(["Work", "Ideas", "Shopping"]);
  });

  it("ignores a stale id and still reorders the rest", () => {
    // A stale admin screen posting a category someone else just deleted should not fail
    // the reorder of the ones that remain.
    const repo = new FakeNoteCategoryRepository(["Ideas", "Shopping"]);

    const strip = reorderCategories(repo, { ids: [999, 2, 1] });

    expect(strip.map((category) => category.name)).toEqual(["Shopping", "Ideas"]);
  });
});

describe("deleteCategory", () => {
  it("deletes an empty category", () => {
    const repo = new FakeNoteCategoryRepository(["Ideas"]);

    expect(deleteCategory(repo, { id: 1 })).toEqual({ ok: true });
    expect(repo.count()).toBe(0);
  });

  it("refuses while notes are filed under it, and leaves it in place", () => {
    // The module's central guard. Cascading would let an admin destroy other people's
    // notes from a settings screen, with no way for a non-admin to recover them.
    const repo = new FakeNoteCategoryRepository(["Shopping"]);
    repo.setNoteCount(1, 12, 3);

    const result = deleteCategory(repo, { id: 1 });

    expect(result).toEqual({
      ok: false,
      refusal: { kind: "not-empty", noteCount: 12, ownerCount: 3 },
    });
    expect(repo.count()).toBe(1);
  });

  it("reports a category that has already gone", () => {
    expect(deleteCategory(new FakeNoteCategoryRepository(), { id: 404 })).toEqual({
      ok: false,
      refusal: { kind: "not-found" },
    });
  });
});

describe("describeDeleteRefusal", () => {
  it("says nothing when the delete succeeded", () => {
    expect(describeDeleteRefusal({ ok: true })).toBeUndefined();
  });

  it("pluralises one note by one person", () => {
    expect(
      describeDeleteRefusal({
        ok: false,
        refusal: { kind: "not-empty", noteCount: 1, ownerCount: 1 },
      }),
    ).toBe("1 note is still filed under this category, written by 1 person. Empty it first.");
  });

  it("pluralises many notes by many people", () => {
    expect(
      describeDeleteRefusal({
        ok: false,
        refusal: { kind: "not-empty", noteCount: 12, ownerCount: 3 },
      }),
    ).toBe("12 notes are still filed under this category, written by 3 people. Empty it first.");
  });

  it("mentions counts only — never a note's text or an owner's name", () => {
    // This message is the one thing an admin learns about other people's notebooks, and
    // it stays numeric on purpose.
    const message = describeDeleteRefusal({
      ok: false,
      refusal: { kind: "not-empty", noteCount: 2, ownerCount: 2 },
    });
    expect(message).toBe(
      "2 notes are still filed under this category, written by 2 people. Empty it first.",
    );
  });

  it("explains a missing category", () => {
    expect(describeDeleteRefusal({ ok: false, refusal: { kind: "not-found" } })).toBe(
      "That category no longer exists.",
    );
  });
});
