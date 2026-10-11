import { describe, expect, it } from "vitest";
import { listEntriesUsingLocation } from "./entries-using-location";
import { FakeSavedLocationRepository } from "./fake-repository";

type Usage = FakeSavedLocationRepository["entryLocationUsages"][number];

/** One entry-location row with everything defaulted, so a test names only what it means. */
function usage(overrides: Partial<Usage> = {}): Usage {
  return {
    entryId: 1,
    entryDate: "2026-04-12",
    entryTime: "09:30",
    title: "Morning writing",
    isEncrypted: false,
    placeName: "",
    savedLocationId: 1,
    ...overrides,
  };
}

function repoWith(rows: Usage[]): FakeSavedLocationRepository {
  const repo = new FakeSavedLocationRepository();
  repo.entryLocationUsages = rows;
  return repo;
}

describe("listEntriesUsingLocation", () => {
  it("returns the entries whose locations came from this place", () => {
    const repo = repoWith([
      usage({ entryId: 1, title: "Morning writing" }),
      usage({ entryId: 2, title: "Second visit" }),
    ]);

    const entries = listEntriesUsingLocation(repo, 1);

    expect(entries.map((entry) => entry.title)).toEqual(["Second visit", "Morning writing"]);
  });

  it("ignores entries that came from a different place", () => {
    const repo = repoWith([
      usage({ entryId: 1, savedLocationId: 1 }),
      usage({ entryId: 2, savedLocationId: 2, title: "Somewhere else" }),
    ]);

    const entries = listEntriesUsingLocation(repo, 1);

    expect(entries).toHaveLength(1);
    expect(entries[0].entryId).toBe(1);
  });

  it("collapses an entry that used the same place twice into one row", () => {
    // The whole reason the row carries a count: a day trip with two stops at
    // one cafe is one entry, and listing it twice would read as two days.
    const repo = repoWith([usage({ entryId: 7 }), usage({ entryId: 7 })]);

    const entries = listEntriesUsingLocation(repo, 1);

    expect(entries).toHaveLength(1);
    expect(entries[0].locationCount).toBe(2);
  });

  it("orders newest first, breaking ties on time and then id", () => {
    const repo = repoWith([
      usage({ entryId: 1, entryDate: "2025-11-20", entryTime: "18:00" }),
      usage({ entryId: 2, entryDate: "2026-04-12", entryTime: "09:30" }),
      usage({ entryId: 3, entryDate: "2026-04-12", entryTime: "21:00" }),
      usage({ entryId: 4, entryDate: "2026-04-12", entryTime: "21:00" }),
    ]);

    const entries = listEntriesUsingLocation(repo, 1);

    expect(entries.map((entry) => entry.entryId)).toEqual([4, 3, 2, 1]);
  });

  it("carries the encrypted flag, so the caller can show a placeholder", () => {
    // An encrypted entry's title column reads as "" — the flag is the only way
    // to tell it from an entry genuinely left untitled.
    const repo = repoWith([usage({ title: "", isEncrypted: true })]);

    expect(listEntriesUsingLocation(repo, 1)[0]).toMatchObject({
      title: "",
      isEncrypted: true,
    });
  });

  it("returns an empty list for a place nothing uses", () => {
    expect(listEntriesUsingLocation(repoWith([]), 1)).toEqual([]);
  });

  it("returns an empty list for a place that no longer exists", () => {
    // Deleted in another tab: an empty list, not an error — the caller renders
    // it the same way it renders an unused place.
    const repo = repoWith([usage({ savedLocationId: 1 })]);

    expect(listEntriesUsingLocation(repo, 999)).toEqual([]);
  });

  it.each([0, -1, 2.5])("rejects %s as an id", (id) => {
    // A malformed id is a bug in the caller, not a place that happens to be
    // unused, so it throws rather than reading as empty.
    expect(() => listEntriesUsingLocation(repoWith([]), id)).toThrow();
  });
});
