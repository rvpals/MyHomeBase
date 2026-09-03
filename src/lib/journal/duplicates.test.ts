import { describe, expect, it } from "vitest";
import {
  DUPLICATE_EXCERPT_WORDS,
  countDuplicateEntries,
  excerptWords,
  findDuplicateGroups,
  toDuplicateRows,
} from "./duplicates";
import type { JournalEntry } from "./types";

function entry(overrides: Partial<JournalEntry> & { id: number }): JournalEntry {
  return {
    date: "2026-01-01",
    time: "",
    title: "Untitled",
    content: "",
    placeName: "",
    isPinned: false,
    isLocked: false,
    categories: [],
    tags: [],
    locations: [],
    createdAt: "2026-01-01 08:00:00",
    updatedAt: "2026-01-01 08:00:00",
    ...overrides,
  };
}

describe("excerptWords", () => {
  it("returns short content unchanged and without an ellipsis", () => {
    expect(excerptWords("a short entry")).toBe("a short entry");
  });

  it("cuts to the word limit and marks the cut", () => {
    const content = Array.from({ length: 120 }, (_, index) => `w${index}`).join(" ");
    const result = excerptWords(content);

    expect(result.endsWith("…")).toBe(true);
    expect(result.replace("…", "").split(" ")).toHaveLength(DUPLICATE_EXCERPT_WORDS);
    expect(result.startsWith("w0 w1 w2")).toBe(true);
  });

  it("treats newlines and tabs as word separators, not as part of a word", () => {
    expect(excerptWords("one\ntwo\t\tthree   four", 3)).toBe("one two three…");
  });

  it("returns empty string for blank or whitespace-only content", () => {
    expect(excerptWords("")).toBe("");
    expect(excerptWords("   \n  ")).toBe("");
  });

  it("honours a caller-supplied limit", () => {
    expect(excerptWords("alpha beta gamma", 2)).toBe("alpha beta…");
  });
});

describe("findDuplicateGroups", () => {
  it("groups entries sharing a date and title", () => {
    const groups = findDuplicateGroups([
      entry({ id: 1, date: "2026-03-01", title: "Morning run", content: "first" }),
      entry({ id: 2, date: "2026-03-01", title: "Morning run", content: "second" }),
      entry({ id: 3, date: "2026-03-01", title: "Something else" }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].date).toBe("2026-03-01");
    expect(groups[0].title).toBe("Morning run");
    expect(groups[0].entries.map((item) => item.id)).toEqual([1, 2]);
  });

  it("returns nothing when every entry is unique", () => {
    const groups = findDuplicateGroups([
      entry({ id: 1, date: "2026-03-01", title: "A" }),
      entry({ id: 2, date: "2026-03-02", title: "A" }),
      entry({ id: 3, date: "2026-03-01", title: "B" }),
    ]);

    expect(groups).toEqual([]);
  });

  it("matches titles case-insensitively and ignores surrounding space", () => {
    const groups = findDuplicateGroups([
      entry({ id: 1, date: "2026-03-01", title: "Morning Run" }),
      entry({ id: 2, date: "2026-03-01", title: "  morning run " }),
    ]);

    expect(groups).toHaveLength(1);
    // The displayed title is the first member's, as typed — not the lowercased key.
    expect(groups[0].title).toBe("Morning Run");
  });

  it("counts entries at different times on one date as duplicates", () => {
    const groups = findDuplicateGroups([
      entry({ id: 1, date: "2026-03-01", time: "21:00", title: "Journal" }),
      entry({ id: 2, date: "2026-03-01", time: "09:00", title: "Journal" }),
    ]);

    expect(groups).toHaveLength(1);
    // Ordered by time, so the earlier one reads first regardless of id order in.
    expect(groups[0].entries.map((item) => item.time)).toEqual(["09:00", "21:00"]);
    expect(groups[0].entries.map((item) => item.id)).toEqual([2, 1]);
  });

  it("skips untitled entries rather than grouping them on their empty title", () => {
    const groups = findDuplicateGroups([
      entry({ id: 1, date: "2026-03-01", title: "" }),
      entry({ id: 2, date: "2026-03-01", title: "   " }),
      entry({ id: 3, date: "2026-03-01", title: "" }),
    ]);

    expect(groups).toEqual([]);
  });

  it("orders groups newest date first", () => {
    const groups = findDuplicateGroups([
      entry({ id: 1, date: "2026-01-05", title: "Old" }),
      entry({ id: 2, date: "2026-01-05", title: "Old" }),
      entry({ id: 3, date: "2026-06-05", title: "New" }),
      entry({ id: 4, date: "2026-06-05", title: "New" }),
    ]);

    expect(groups.map((group) => group.date)).toEqual(["2026-06-05", "2026-01-05"]);
  });

  it("carries the excerpt, lock and pin state onto each member", () => {
    const groups = findDuplicateGroups([
      entry({ id: 1, date: "2026-03-01", title: "T", content: "one two three", isLocked: true }),
      entry({ id: 2, date: "2026-03-01", title: "T", content: "", isPinned: true }),
    ]);

    expect(groups[0].entries[0]).toMatchObject({
      id: 1,
      excerpt: "one two three",
      isLocked: true,
    });
    expect(groups[0].entries[1]).toMatchObject({ id: 2, excerpt: "", isPinned: true });
  });

  it("handles an empty input", () => {
    expect(findDuplicateGroups([])).toEqual([]);
  });

  it("keeps a group of three together", () => {
    const groups = findDuplicateGroups([
      entry({ id: 1, date: "2026-03-01", title: "T" }),
      entry({ id: 2, date: "2026-03-01", title: "T" }),
      entry({ id: 3, date: "2026-03-01", title: "T" }),
    ]);

    expect(groups[0].entries).toHaveLength(3);
  });
});

describe("countDuplicateEntries", () => {
  it("totals the members across groups", () => {
    const groups = findDuplicateGroups([
      entry({ id: 1, date: "2026-03-01", title: "A" }),
      entry({ id: 2, date: "2026-03-01", title: "A" }),
      entry({ id: 3, date: "2026-03-02", title: "B" }),
      entry({ id: 4, date: "2026-03-02", title: "B" }),
      entry({ id: 5, date: "2026-03-02", title: "B" }),
    ]);

    expect(countDuplicateEntries(groups)).toBe(5);
  });

  it("is zero for no groups", () => {
    expect(countDuplicateEntries([])).toBe(0);
  });
});

describe("toDuplicateRows", () => {
  it("flattens groups into rows carrying the group identity", () => {
    const rows = toDuplicateRows(
      findDuplicateGroups([
        entry({ id: 1, date: "2026-03-01", title: "Run" }),
        entry({ id: 2, date: "2026-03-01", title: "Run" }),
      ]),
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].groupKey).toBe(rows[1].groupKey);
    expect(rows[0].groupTitle).toBe("Run");
  });

  it("numbers the copies within each group", () => {
    const rows = toDuplicateRows(
      findDuplicateGroups([
        entry({ id: 1, date: "2026-03-01", time: "08:00", title: "Run" }),
        entry({ id: 2, date: "2026-03-01", time: "12:00", title: "Run" }),
        entry({ id: 3, date: "2026-03-01", time: "19:00", title: "Run" }),
      ]),
    );

    expect(rows.map((row) => [row.copyIndex, row.copyCount])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("gives different groups different keys", () => {
    const rows = toDuplicateRows(
      findDuplicateGroups([
        entry({ id: 1, date: "2026-03-01", title: "A" }),
        entry({ id: 2, date: "2026-03-01", title: "A" }),
        entry({ id: 3, date: "2026-03-02", title: "A" }),
        entry({ id: 4, date: "2026-03-02", title: "A" }),
      ]),
    );

    expect(new Set(rows.map((row) => row.groupKey)).size).toBe(2);
  });

  it("keeps the excerpt and flags from the underlying entry", () => {
    const rows = toDuplicateRows(
      findDuplicateGroups([
        entry({ id: 1, date: "2026-03-01", title: "T", content: "hello there", isLocked: true }),
        entry({ id: 2, date: "2026-03-01", title: "T" }),
      ]),
    );

    expect(rows[0]).toMatchObject({ id: 1, excerpt: "hello there", isLocked: true });
  });

  it("returns nothing for no groups", () => {
    expect(toDuplicateRows([])).toEqual([]);
  });
});
