import { describe, expect, it } from "vitest";
import {
  ON_THIS_DAY_EXCERPT_WORDS,
  listEntriesOnMonthDay,
  listEntriesOnMonthDayKey,
  monthDayOf,
} from "./on-this-day";
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

  it("blanks the body and carries a short excerpt in its place", () => {
    const { repo } = fakeRepo([entry(1, "2026-11-24")]);

    const [row] = listEntriesOnMonthDay(repo, "2026-11-24");

    expect(row.content).toBe("");
    expect(row.excerpt).toBe("the body of this entry");
    expect(row.title).toBe("Entry 1");
  });

  it("cuts a long body at the word limit and marks it as cut", () => {
    const body = Array.from({ length: ON_THIS_DAY_EXCERPT_WORDS + 40 }, (_, i) => `w${i}`).join(" ");
    const { repo } = fakeRepo([entry(1, "2026-11-24", { content: body })]);

    const [row] = listEntriesOnMonthDay(repo, "2026-11-24");

    expect(row.excerpt.endsWith("…")).toBe(true);
    expect(row.excerpt.replace("…", "").trim().split(/\s+/)).toHaveLength(
      ON_THIS_DAY_EXCERPT_WORDS,
    );
  });

  it("leaves a body shorter than the limit uncut", () => {
    const { repo } = fakeRepo([entry(1, "2026-11-24", { content: "two words" })]);

    expect(listEntriesOnMonthDay(repo, "2026-11-24")[0].excerpt).toBe("two words");
  });

  /**
   * Migration 0131 blanks `content` on an encrypted row and keeps the ciphertext
   * in `contentEncrypted`, which this module never reads — so the empty excerpt
   * falls out rather than needing a branch. Pinned because a future change that
   * excerpted `contentEncrypted` instead would leak ciphertext onto the screen.
   */
  it("gives an encrypted entry an empty excerpt, never its ciphertext", () => {
    const { repo } = fakeRepo([
      entry(1, "2026-11-24", {
        content: "",
        isEncrypted: true,
        contentEncrypted: "AAAA-ciphertext-BBBB",
      }),
    ]);

    expect(listEntriesOnMonthDay(repo, "2026-11-24")[0].excerpt).toBe("");
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
    expect(result[0].excerpt).toBe("the body of this entry");
  });

  it("rejects anything that isn't MM-DD", () => {
    const { repo } = fakeRepo();

    expect(() => listEntriesOnMonthDayKey(repo, "2026-11-24")).toThrow(/MM-DD/);
  });
});
