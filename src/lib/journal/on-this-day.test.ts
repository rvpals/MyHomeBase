import { describe, expect, it } from "vitest";
import { listEntriesOnMonthDay, listEntriesOnMonthDayKey, monthDayOf } from "./on-this-day";
import type { JournalRepository } from "./ports";
import type { JournalEntry } from "./types";

function entry(id: number, date: string, overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id,
    date,
    time: "",
    title: `Entry ${id}`,
    content: "the body of this entry",
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
    ...overrides,
  };
}

/**
 * Stands in for the real query, which filters on `substr(entry_date, 6, 5)` and
 * orders newest first. Both are reproduced here so a test that expects an order
 * is testing the use-case against the contract rather than against itself.
 */
function fakeRepo(rows: JournalEntry[] = []) {
  const asked: string[] = [];
  const repo = {
    listEntriesByMonthDay: (monthDay: string) => {
      asked.push(monthDay);
      return rows
        .filter((row) => row.date.slice(5) === monthDay)
        .sort((a, b) => b.date.localeCompare(a.date));
    },
  } as unknown as JournalRepository;
  return { repo, asked };
}

describe("monthDayOf", () => {
  it("takes the month and day off an ISO date", () => {
    expect(monthDayOf("2026-11-24")).toBe("11-24");
  });

  it("rejects anything that isn't YYYY-MM-DD", () => {
    expect(() => monthDayOf("November 24, 2026")).toThrow(/YYYY-MM-DD/);
    expect(() => monthDayOf("2026-11")).toThrow(/YYYY-MM-DD/);
  });
});

describe("listEntriesOnMonthDay", () => {
  it("returns every year's entry on that month and day, newest first", () => {
    const { repo, asked } = fakeRepo([
      entry(1, "2019-11-24"),
      entry(2, "2023-11-24"),
      entry(3, "2026-11-24"),
      entry(4, "2026-11-25"),
      entry(5, "2026-12-24"),
    ]);

    const result = listEntriesOnMonthDay(repo, "2026-11-24");

    expect(asked).toEqual(["11-24"]);
    expect(result.map((row) => row.date)).toEqual(["2026-11-24", "2023-11-24", "2019-11-24"]);
  });

  /**
   * The deliberate difference from `listTodayInHistory`, which backs the home
   * screen's card: that one drops the reference year, so the two lists can show
   * different counts for the same date. See the docblock on this module.
   */
  it("keeps entries in the reference year itself, unlike listTodayInHistory", () => {
    const { repo } = fakeRepo([entry(1, "2026-11-24"), entry(2, "2019-11-24")]);

    expect(listEntriesOnMonthDay(repo, "2026-11-24").map((row) => row.id)).toEqual([1, 2]);
  });

  it("blanks the body — the grid never reads it and the read is unbounded", () => {
    const { repo } = fakeRepo([entry(1, "2026-11-24")]);

    const [row] = listEntriesOnMonthDay(repo, "2026-11-24");

    expect(row.content).toBe("");
    expect(row.title).toBe("Entry 1");
  });

  it("matches only other leap years on February 29", () => {
    const { repo, asked } = fakeRepo([
      entry(1, "2024-02-29"),
      entry(2, "2023-02-28"),
      entry(3, "2020-02-29"),
    ]);

    const result = listEntriesOnMonthDay(repo, "2024-02-29");

    expect(asked).toEqual(["02-29"]);
    expect(result.map((row) => row.id)).toEqual([1, 3]);
  });

  it("returns nothing when no entry falls on that month and day", () => {
    const { repo } = fakeRepo([entry(1, "2026-03-01")]);

    expect(listEntriesOnMonthDay(repo, "2026-11-24")).toEqual([]);
  });

  it("rejects a date that isn't YYYY-MM-DD", () => {
    const { repo } = fakeRepo();

    expect(() => listEntriesOnMonthDay(repo, "24/11/2026")).toThrow(/YYYY-MM-DD/);
  });
});

describe("listEntriesOnMonthDayKey", () => {
  it("answers the same question from a month-day alone", () => {
    const { repo, asked } = fakeRepo([entry(1, "2019-11-24"), entry(2, "2026-11-24")]);

    const result = listEntriesOnMonthDayKey(repo, "11-24");

    expect(asked).toEqual(["11-24"]);
    expect(result.map((row) => row.date)).toEqual(["2026-11-24", "2019-11-24"]);
    expect(result[0].content).toBe("");
  });

  it("rejects anything that isn't MM-DD", () => {
    const { repo } = fakeRepo();

    expect(() => listEntriesOnMonthDayKey(repo, "2026-11-24")).toThrow(/MM-DD/);
  });
});
