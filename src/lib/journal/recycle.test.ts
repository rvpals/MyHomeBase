import { describe, expect, it } from "vitest";
import {
  countRecycledEntries,
  deleteRecycledEntriesForever,
  emptyRecycleBin,
  listRecycledEntries,
  recycleEntries,
  restoreRecycledEntries,
} from "./recycle";
import type { JournalRepository } from "./ports";
import type { RecycledJournalEntry } from "./types";

function recycled(overrides: Partial<RecycledJournalEntry> & { recycledId: number }): RecycledJournalEntry {
  return {
    id: overrides.recycledId,
    date: "2026-01-01",
    time: "",
    title: "Deleted entry",
    content: "",
    placeName: "",
    isPinned: false,
    isLocked: false,
    categories: [],
    tags: [],
    locations: [],
    createdAt: "2026-01-01 08:00:00",
    updatedAt: "2026-01-01 08:00:00",
    deletedAt: "2026-02-01 08:00:00",
    ...overrides,
  };
}

/**
 * A fake covering only the bin. These use-cases are thin over the repository, so
 * what the tests pin down is the contract — the counts reported back, the
 * de-duping, and the refusal of an empty selection — not the SQL.
 *
 * `known` is the set of ids the fake will act on; anything else is "skipped",
 * which is how the repository behaves for an id that has already gone.
 */
function fakeRepo(options: { known?: number[]; bin?: RecycledJournalEntry[] } = {}) {
  const known = new Set(options.known ?? []);
  let bin = options.bin ?? [];
  const calls: { method: string; ids: number[] }[] = [];

  function actOn(method: string, ids: number[]): number {
    calls.push({ method, ids });
    return ids.filter((id) => known.has(id)).length;
  }

  const repo = {
    recycleEntries: (ids: number[]) => actOn("recycleEntries", ids),
    listRecycledEntries: () => bin,
    restoreRecycledEntries: (ids: number[]) => actOn("restoreRecycledEntries", ids),
    deleteRecycledEntriesForever: (ids: number[]) => actOn("deleteRecycledEntriesForever", ids),
    emptyRecycleBin: () => {
      const count = bin.length;
      bin = [];
      return count;
    },
    countRecycledEntries: () => bin.length,
  } as unknown as JournalRepository;

  return { repo, calls };
}

describe("recycleEntries", () => {
  it("moves the given entries and reports the count", () => {
    const { repo } = fakeRepo({ known: [1, 2, 3] });

    expect(recycleEntries(repo, [1, 2])).toEqual({ movedCount: 2, skippedCount: 0 });
  });

  it("reports ids that no longer exist as skipped rather than throwing", () => {
    const { repo } = fakeRepo({ known: [1] });

    expect(recycleEntries(repo, [1, 99])).toEqual({ movedCount: 1, skippedCount: 1 });
  });

  it("de-dupes a repeated id so the count matches what the user was shown", () => {
    const { repo, calls } = fakeRepo({ known: [1] });

    expect(recycleEntries(repo, [1, 1, 1])).toEqual({ movedCount: 1, skippedCount: 0 });
    expect(calls[0].ids).toEqual([1]);
  });

  it("rejects an empty selection", () => {
    const { repo } = fakeRepo({ known: [1] });

    expect(() => recycleEntries(repo, [])).toThrow(/at least one/i);
  });

  it("rejects a non-positive id", () => {
    const { repo } = fakeRepo({ known: [1] });

    expect(() => recycleEntries(repo, [0])).toThrow();
    expect(() => recycleEntries(repo, [-4])).toThrow();
  });

  it("does not re-check that the entries are duplicates", () => {
    // The ids are whatever the user ticked; the use-case passes them straight
    // through. Nothing here consults a duplicate finder.
    const { repo, calls } = fakeRepo({ known: [7] });

    recycleEntries(repo, [7]);

    expect(calls).toEqual([{ method: "recycleEntries", ids: [7] }]);
  });
});

describe("listRecycledEntries", () => {
  it("returns what the bin holds", () => {
    const { repo } = fakeRepo({ bin: [recycled({ recycledId: 5, title: "Gone" })] });

    const list = listRecycledEntries(repo);

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ recycledId: 5, title: "Gone" });
  });

  it("returns an empty list for an empty bin", () => {
    const { repo } = fakeRepo();

    expect(listRecycledEntries(repo)).toEqual([]);
  });
});

describe("restoreRecycledEntries", () => {
  it("restores the given rows and reports the count", () => {
    const { repo } = fakeRepo({ known: [10, 11] });

    expect(restoreRecycledEntries(repo, [10, 11])).toEqual({ restoredCount: 2, skippedCount: 0 });
  });

  it("skips rows already gone from the bin", () => {
    const { repo } = fakeRepo({ known: [10] });

    expect(restoreRecycledEntries(repo, [10, 12])).toEqual({ restoredCount: 1, skippedCount: 1 });
  });

  it("rejects an empty selection", () => {
    const { repo } = fakeRepo();

    expect(() => restoreRecycledEntries(repo, [])).toThrow(/at least one/i);
  });
});

describe("deleteRecycledEntriesForever", () => {
  it("purges the given rows and reports the count", () => {
    const { repo } = fakeRepo({ known: [3, 4] });

    expect(deleteRecycledEntriesForever(repo, [3, 4])).toEqual({
      deletedCount: 2,
      skippedCount: 0,
    });
  });

  it("skips rows already gone", () => {
    const { repo } = fakeRepo({ known: [3] });

    expect(deleteRecycledEntriesForever(repo, [3, 4])).toEqual({
      deletedCount: 1,
      skippedCount: 1,
    });
  });

  it("rejects an empty selection", () => {
    const { repo } = fakeRepo();

    expect(() => deleteRecycledEntriesForever(repo, [])).toThrow(/at least one/i);
  });
});

describe("emptyRecycleBin", () => {
  it("removes everything and reports how many went", () => {
    const { repo } = fakeRepo({
      bin: [recycled({ recycledId: 1 }), recycled({ recycledId: 2 })],
    });

    expect(emptyRecycleBin(repo)).toEqual({ deletedCount: 2 });
    expect(listRecycledEntries(repo)).toEqual([]);
  });

  it("is a no-op reporting zero on an already empty bin, not an error", () => {
    const { repo } = fakeRepo();

    expect(emptyRecycleBin(repo)).toEqual({ deletedCount: 0 });
  });
});

describe("countRecycledEntries", () => {
  it("counts what the bin holds", () => {
    const { repo } = fakeRepo({ bin: [recycled({ recycledId: 1 })] });

    expect(countRecycledEntries(repo)).toBe(1);
  });

  it("is zero for an empty bin", () => {
    expect(countRecycledEntries(fakeRepo().repo)).toBe(0);
  });
});
