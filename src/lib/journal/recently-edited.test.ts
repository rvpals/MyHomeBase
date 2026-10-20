import { describe, expect, it } from "vitest";
import { RECENTLY_EDITED_ENTRY_LIMIT, listRecentlyEditedEntries } from "./recently-edited";
import type { JournalRepository } from "./ports";
import type { JournalEntry, JournalFilter } from "./types";

function entry(id: number, title: string, updatedAt: string): JournalEntry {
  return {
    id,
    date: "2026-03-01",
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
    updatedAt,
  };
}

/**
 * Records what `findEntries` was asked for. As in `pinned-entries.test.ts`, the
 * filter this use-case builds *is* its behaviour — the ordering itself is SQL, and
 * `buildOrderBy` is covered in `filters.test.ts`.
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

describe("listRecentlyEditedEntries", () => {
  it("asks for every entry ordered by newest edit first", () => {
    const { repo, calls } = fakeRepo();

    listRecentlyEditedEntries(repo);

    expect(calls).toHaveLength(1);
    expect(calls[0].filter).toEqual({
      join: "AND",
      groups: [],
      sort: [{ field: "updatedAt", direction: "desc" }],
    });
  });

  it("narrows nothing — an empty group list is what makes every entry a candidate", () => {
    const { repo, calls } = fakeRepo();

    listRecentlyEditedEntries(repo);

    // The guarantee behind the card: it is a recency feed, not a filtered view, so
    // a stray condition here would silently hide entries the reader just edited.
    expect(calls[0].filter.groups).toEqual([]);
  });

  it("defaults to RECENTLY_EDITED_ENTRY_LIMIT", () => {
    const { repo, calls } = fakeRepo();

    listRecentlyEditedEntries(repo);

    expect(calls[0].limit).toBe(RECENTLY_EDITED_ENTRY_LIMIT);
    expect(RECENTLY_EDITED_ENTRY_LIMIT).toBe(20);
  });

  it("passes an explicit limit through", () => {
    const { repo, calls } = fakeRepo();

    listRecentlyEditedEntries(repo, 5);

    expect(calls[0].limit).toBe(5);
  });

  it("returns the repository's rows untouched, in the order given", () => {
    const rows = [
      entry(3, "Edited today", "2026-03-03T09:00:00.000Z"),
      entry(1, "Edited last week", "2026-02-24T09:00:00.000Z"),
    ];
    const { repo } = fakeRepo(rows);

    // No re-sorting in the use-case: SQL already ordered these, and sorting again
    // here would be a second, divergent opinion about what "recent" means.
    expect(listRecentlyEditedEntries(repo)).toEqual(rows);
  });

  it("keeps a never-edited entry, whose updatedAt still equals its createdAt", () => {
    const untouched = entry(7, "Written, never edited", "2026-01-01T00:00:00.000Z");
    const { repo } = fakeRepo([untouched]);

    expect(listRecentlyEditedEntries(repo)).toEqual([untouched]);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects %s as a limit", (limit) => {
    const { repo, calls } = fakeRepo();

    expect(() => listRecentlyEditedEntries(repo, limit)).toThrow(/positive integer/);
    expect(calls).toHaveLength(0);
  });
});
