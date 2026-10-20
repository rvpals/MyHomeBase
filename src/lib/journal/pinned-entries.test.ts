import { describe, expect, it } from "vitest";
import { PINNED_ENTRY_LIMIT, listPinnedEntries } from "./pinned-entries";
import type { JournalRepository } from "./ports";
import type { JournalEntry, JournalFilter } from "./types";

function entry(id: number, title: string): JournalEntry {
  return {
    id,
    date: "2026-03-01",
    time: "",
    title,
    content: "",
    placeName: "",
    isPinned: true,
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
 * Records what `findEntries` was asked for, so the tests can assert the filter this
 * use-case builds — that filter *is* the behaviour here, since the matching itself
 * belongs to the filter engine and is covered by `filters.test.ts`.
 */
function fakeRepo(rows: JournalEntry[] = []) {
  const calls: { filter: JournalFilter; limit: number }[] = [];
  const repo = {
    findEntries: (filter: JournalFilter, limit: number) => {
      calls.push({ filter, limit });
      return rows;
    },
  } as unknown as JournalRepository;
  return { repo, calls };
}

describe("listPinnedEntries", () => {
  it("asks for entries whose isPinned is true", () => {
    const { repo, calls } = fakeRepo();

    listPinnedEntries(repo);

    expect(calls).toHaveLength(1);
    expect(calls[0].filter).toEqual({
      join: "AND",
      groups: [
        { join: "AND", conditions: [{ field: "isPinned", operator: "is", value: "true" }] },
      ],
    });
  });

  it("returns what the repository matched", () => {
    const rows = [entry(1, "Trip"), entry(2, "Move")];
    const { repo } = fakeRepo(rows);

    expect(listPinnedEntries(repo)).toEqual(rows);
  });

  it("defaults to the card's limit, and passes an explicit one through", () => {
    const { repo, calls } = fakeRepo();

    listPinnedEntries(repo);
    listPinnedEntries(repo, 3);

    expect(calls[0].limit).toBe(PINNED_ENTRY_LIMIT);
    expect(calls[1].limit).toBe(3);
  });

  it("keeps Log entries, unlike Today in History", () => {
    // Pinning is explicit, so a pinned logged activity is one the reader chose.
    const log = { ...entry(5, "Swim practice"), categories: ["Log"] };
    const { repo } = fakeRepo([log]);

    expect(listPinnedEntries(repo)).toEqual([log]);
  });

  it("rejects a limit that is not a positive integer", () => {
    const { repo, calls } = fakeRepo();

    expect(() => listPinnedEntries(repo, 0)).toThrow(/positive integer/);
    expect(() => listPinnedEntries(repo, -1)).toThrow(/positive integer/);
    expect(() => listPinnedEntries(repo, 2.5)).toThrow(/positive integer/);
    // Rejected before the repository is touched, not after.
    expect(calls).toHaveLength(0);
  });
});
