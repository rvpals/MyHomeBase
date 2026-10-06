import { describe, expect, it } from "vitest";
import { applyNameChange, bulkEditEntries, describeBulkEditResult } from "./bulk-edit";
import type { BulkEntryEditData, BulkEntryEditOutcome, JournalRepository } from "./index";

/**
 * A fake standing in for the one repository method this use-case calls.
 *
 * `bulkEditEntries` in `lib` is validation, name-folding and taxonomy
 * registration over a single repository call, so what the tests pin down is that
 * contract — what gets normalized before it reaches SQL, what gets registered,
 * and what the reported counts mean. The fold itself is tested directly through
 * `applyNameChange`, which is why it's exported.
 *
 * `locked`/`missing` let a test say which of the requested ids the repository
 * would refuse, without a database.
 */
function fakeRepo(options: { locked?: number[]; missing?: number[] } = {}) {
  const locked = new Set(options.locked ?? []);
  const missing = new Set(options.missing ?? []);
  const calls: {
    bulkEdit: { ids: number[]; changes: BulkEntryEditData }[];
    registeredCategories: string[][];
    registeredTags: string[][];
  } = { bulkEdit: [], registeredCategories: [], registeredTags: [] };

  const repo = {
    registerCategoriesIfMissing: (names: string[]) => calls.registeredCategories.push(names),
    registerTagsIfMissing: (names: string[]) => calls.registeredTags.push(names),
    bulkEditEntries: (ids: number[], changes: BulkEntryEditData): BulkEntryEditOutcome => {
      calls.bulkEdit.push({ ids, changes });
      return {
        updatedIds: ids.filter((id) => !locked.has(id) && !missing.has(id)),
        skippedLockedIds: ids.filter((id) => locked.has(id)),
        missingIds: ids.filter((id) => missing.has(id)),
      };
    },
  } as unknown as JournalRepository;

  return { repo, calls };
}

describe("applyNameChange", () => {
  it("appends only the names an entry doesn't already carry", () => {
    expect(applyNameChange(["Trip", "Food"], { mode: "add", names: ["Food", "Beach"] })).toEqual([
      "Trip",
      "Food",
      "Beach",
    ]);
  });

  it("keeps the entry's own spelling when an added name differs only by case", () => {
    // Re-casing an entry's existing names is a rename, which belongs in the Meta
    // Data screen. A bulk add must not quietly perform one.
    expect(applyNameChange(["museum"], { mode: "add", names: ["Museum"] })).toEqual(["museum"]);
  });

  it("removes names case-insensitively", () => {
    expect(applyNameChange(["Trip", "museum"], { mode: "remove", names: ["MUSEUM"] })).toEqual([
      "Trip",
    ]);
  });

  it("leaves an entry untouched when the names to remove aren't on it", () => {
    expect(applyNameChange(["Trip"], { mode: "remove", names: ["Beach"] })).toEqual(["Trip"]);
  });

  it("replaces the whole list, discarding what was there", () => {
    expect(applyNameChange(["Trip", "Food"], { mode: "replace", names: ["Beach"] })).toEqual([
      "Beach",
    ]);
  });

  it("clears the list when replace is given no names", () => {
    expect(applyNameChange(["Trip"], { mode: "replace", names: [] })).toEqual([]);
  });
});

describe("bulkEditEntries", () => {
  it("applies a change and reports the entries written", () => {
    const { repo } = fakeRepo();

    const result = bulkEditEntries(repo, [1, 2, 3], {
      tags: { mode: "add", names: ["Beach"] },
    });

    expect(result).toEqual({ updatedCount: 3, skippedLockedCount: 0, missingCount: 0 });
  });

  it("reports locked entries as skipped rather than failing the whole edit", () => {
    const { repo } = fakeRepo({ locked: [2] });

    const result = bulkEditEntries(repo, [1, 2, 3], {
      tags: { mode: "add", names: ["Beach"] },
    });

    expect(result).toEqual({ updatedCount: 2, skippedLockedCount: 1, missingCount: 0 });
  });

  it("reports ids that no longer exist separately from locked ones", () => {
    const { repo } = fakeRepo({ locked: [2], missing: [3] });

    const result = bulkEditEntries(repo, [1, 2, 3], { placeName: "Lisbon" });

    expect(result).toEqual({ updatedCount: 1, skippedLockedCount: 1, missingCount: 1 });
  });

  it("de-dupes a repeated id so the count matches what the reader was shown", () => {
    const { repo, calls } = fakeRepo();

    const result = bulkEditEntries(repo, [1, 1, 1], { placeName: "Lisbon" });

    expect(calls.bulkEdit[0].ids).toEqual([1]);
    expect(result.updatedCount).toBe(1);
  });

  it("trims, drops blanks and case-folds duplicate names before writing", () => {
    const { repo, calls } = fakeRepo();

    bulkEditEntries(repo, [1], {
      tags: { mode: "add", names: ["  Beach  ", "", "beach", "Food"] },
    });

    expect(calls.bulkEdit[0].changes.tags).toEqual({ mode: "add", names: ["Beach", "Food"] });
  });

  it("registers added categories and tags so a new name needs no separate trip", () => {
    const { repo, calls } = fakeRepo();

    bulkEditEntries(repo, [1], {
      categories: { mode: "add", names: ["Travel"] },
      tags: { mode: "replace", names: ["Beach"] },
    });

    expect(calls.registeredCategories).toEqual([["Travel"]]);
    expect(calls.registeredTags).toEqual([["Beach"]]);
  });

  it("registers nothing for a remove — naming a tag to strip it must not mint it", () => {
    const { repo, calls } = fakeRepo();

    bulkEditEntries(repo, [1], { tags: { mode: "remove", names: ["Obsolete"] } });

    expect(calls.registeredTags).toEqual([]);
  });

  it("trims the place name", () => {
    const { repo, calls } = fakeRepo();

    bulkEditEntries(repo, [1], { placeName: "  Lisbon  " });

    expect(calls.bulkEdit[0].changes.placeName).toBe("Lisbon");
  });

  it("allows clearing the place name with an empty string", () => {
    const { repo, calls } = fakeRepo();

    bulkEditEntries(repo, [1], { placeName: "" });

    expect(calls.bulkEdit[0].changes.placeName).toBe("");
  });

  it("rejects an empty selection", () => {
    const { repo } = fakeRepo();

    expect(() => bulkEditEntries(repo, [], { placeName: "Lisbon" })).toThrow(
      /Select at least one entry/,
    );
  });

  it("rejects a selection with no field enabled", () => {
    const { repo } = fakeRepo();

    expect(() => bulkEditEntries(repo, [1], {})).toThrow(/at least one field/);
  });

  it("rejects an add with no names, which is a reader who forgot to type", () => {
    const { repo } = fakeRepo();

    expect(() => bulkEditEntries(repo, [1], { tags: { mode: "add", names: [] } })).toThrow(
      /Name at least one category or tag/,
    );
  });

  it("rejects an add whose names are all blank once trimmed", () => {
    const { repo } = fakeRepo();

    // The schema sees non-empty strings and passes; the normalize step empties
    // the list. Without the post-normalize guard this would reach the repository
    // as a silent no-op that still reported rows updated.
    expect(() => bulkEditEntries(repo, [1], { tags: { mode: "add", names: ["  ", ""] } })).toThrow(
      /Name at least one tag to add/,
    );
  });

  it("rejects a negative or zero id rather than passing it to SQL", () => {
    const { repo } = fakeRepo();

    expect(() => bulkEditEntries(repo, [0], { placeName: "Lisbon" })).toThrow();
    expect(() => bulkEditEntries(repo, [-3], { placeName: "Lisbon" })).toThrow();
  });
});

describe("describeBulkEditResult", () => {
  it("reads as one sentence when everything was written", () => {
    expect(
      describeBulkEditResult({ updatedCount: 4, skippedLockedCount: 0, missingCount: 0 }),
    ).toBe("Updated 4 entries.");
  });

  it("singularises a single entry", () => {
    expect(
      describeBulkEditResult({ updatedCount: 1, skippedLockedCount: 0, missingCount: 0 }),
    ).toBe("Updated 1 entry.");
  });

  it("names locked and missing rows so a short count is never a mystery", () => {
    expect(
      describeBulkEditResult({ updatedCount: 2, skippedLockedCount: 3, missingCount: 1 }),
    ).toBe("Updated 2 entries. 3 were locked and skipped. 1 no longer exists.");
  });

  it("still says something when nothing was written", () => {
    expect(
      describeBulkEditResult({ updatedCount: 0, skippedLockedCount: 1, missingCount: 0 }),
    ).toBe("Updated 0 entries. 1 was locked and skipped.");
  });
});
