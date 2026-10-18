import { describe, expect, it } from "vitest";
import {
  countEntriesPerSavedLocation,
  hasLinkedEntries,
  listEntriesAtSavedLocation,
} from "./entry-locations";
import type { JournalRepository } from "./ports";
import type { JournalEntry } from "./types";

function entry(id: number, date: string, title: string): JournalEntry {
  return {
    id,
    date,
    time: "",
    title,
    content: "",
    placeName: "",
    isPinned: false,
    isLocked: false,
    isEncrypted: false,
    titleEncrypted: "",
    contentEncrypted: "",
    passwordHint: "",
    categories: [],
    tags: [],
    locations: [],
    source: "manual",
    externalId: "",
    externalContent: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * Only the two reads these use-cases touch. Cast because `JournalRepository` is
 * wide and the rest is genuinely unused here — the same shape `neighbors.test`
 * uses for the same reason.
 */
function fakeRepo(
  counts: Map<number, number>,
  byLocation: Map<number, JournalEntry[]> = new Map(),
): JournalRepository {
  return {
    countEntriesBySavedLocation: () => counts,
    listEntriesBySavedLocation: (id: number) => byLocation.get(id) ?? [],
  } as unknown as JournalRepository;
}

describe("countEntriesPerSavedLocation", () => {
  it("attaches each id's count", () => {
    const repo = fakeRepo(new Map([[7, 3], [9, 1]]));
    expect(countEntriesPerSavedLocation(repo, [7, 9])).toEqual([
      { savedLocationId: 7, entryCount: 3 },
      { savedLocationId: 9, entryCount: 1 },
    ]);
  });

  it("counts a place with no entries as 0 rather than dropping it", () => {
    const repo = fakeRepo(new Map([[7, 2]]));
    expect(countEntriesPerSavedLocation(repo, [7, 42])).toEqual([
      { savedLocationId: 7, entryCount: 2 },
      { savedLocationId: 42, entryCount: 0 },
    ]);
  });

  it("keeps the caller's order, not the map's", () => {
    const repo = fakeRepo(new Map([[1, 5], [2, 5], [3, 5]]));
    expect(
      countEntriesPerSavedLocation(repo, [3, 1, 2]).map((usage) => usage.savedLocationId),
    ).toEqual([3, 1, 2]);
  });

  it("returns nothing for an empty library", () => {
    expect(countEntriesPerSavedLocation(fakeRepo(new Map()), [])).toEqual([]);
  });

  it("reports 0 everywhere before anything has been linked", () => {
    const repo = fakeRepo(new Map());
    expect(countEntriesPerSavedLocation(repo, [1, 2, 3]).every((u) => u.entryCount === 0)).toBe(
      true,
    );
  });
});

describe("listEntriesAtSavedLocation", () => {
  it("returns the entries for that place", () => {
    const entries = [entry(2, "2026-05-02", "Second"), entry(1, "2026-05-01", "First")];
    const repo = fakeRepo(new Map(), new Map([[7, entries]]));
    expect(listEntriesAtSavedLocation(repo, 7).map((e) => e.title)).toEqual([
      "Second",
      "First",
    ]);
  });

  it("returns [] for a place nobody has written about", () => {
    expect(listEntriesAtSavedLocation(fakeRepo(new Map()), 7)).toEqual([]);
  });

  it("throws on a non-positive id rather than hiding a bad URL as an empty list", () => {
    const repo = fakeRepo(new Map());
    expect(() => listEntriesAtSavedLocation(repo, 0)).toThrow(/Invalid saved location id/);
    expect(() => listEntriesAtSavedLocation(repo, -1)).toThrow(/Invalid saved location id/);
  });

  it("throws on a non-integer id", () => {
    const repo = fakeRepo(new Map());
    expect(() => listEntriesAtSavedLocation(repo, 1.5)).toThrow(/Invalid saved location id/);
    expect(() => listEntriesAtSavedLocation(repo, Number.NaN)).toThrow(
      /Invalid saved location id/,
    );
  });
});

describe("hasLinkedEntries", () => {
  it("is false before anything has been linked", () => {
    expect(hasLinkedEntries(fakeRepo(new Map()))).toBe(false);
  });

  it("is true once a place has entries", () => {
    expect(hasLinkedEntries(fakeRepo(new Map([[7, 1]])))).toBe(true);
  });
});
