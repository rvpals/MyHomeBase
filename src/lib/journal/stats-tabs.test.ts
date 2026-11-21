import { describe, expect, it } from "vitest";
import {
  JOURNAL_STATS_TAXONOMY_LIMIT,
  JOURNAL_STATS_TOP_TAGS_LIMIT,
  loadJournalStatsTab,
} from "./stats-tabs";
import type { JournalRepository } from "./ports";
import type { JournalEntry } from "./types";

function entry(id: number, title: string, content: string): JournalEntry {
  return {
    id,
    date: "2026-03-01",
    time: "",
    title,
    content,
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

/** Records which repo reads ran, so each test can prove a tab touches only its own. */
function fakeRepo(entries: JournalEntry[] = []) {
  const calls: string[] = [];
  const repo = {
    listTopTags: (limit: number) => {
      calls.push(`tags:${limit}`);
      return [{ name: "beach", entryCount: 3 }];
    },
    listTopCategories: (limit: number) => {
      calls.push(`categories:${limit}`);
      return [{ name: "Travel", entryCount: 5 }];
    },
    countEntriesByYearAndMonth: () => {
      calls.push("years");
      return [{ year: 2026, entryCount: 2, months: [{ month: 3, entryCount: 2 }] }];
    },
    listEntries: () => {
      calls.push("entries");
      return entries;
    },
  } as unknown as JournalRepository;
  return { repo, calls };
}

const OPTIONS = { topWordLimit: 5, excludedWords: [] as string[] };

describe("loadJournalStatsTab", () => {
  it("loads the top tags and categories, and nothing else", () => {
    const { repo, calls } = fakeRepo();
    const data = loadJournalStatsTab(repo, "taxonomy", OPTIONS);

    expect(data).toEqual({
      tab: "taxonomy",
      topTags: [{ name: "beach", entryCount: 3 }],
      topCategories: [{ name: "Travel", entryCount: 5 }],
    });
    expect(calls).toEqual([
      `tags:${JOURNAL_STATS_TOP_TAGS_LIMIT}`,
      `categories:${JOURNAL_STATS_TAXONOMY_LIMIT}`,
    ]);
  });

  it("loads the year and month counts, and nothing else", () => {
    const { repo, calls } = fakeRepo();
    const data = loadJournalStatsTab(repo, "count", OPTIONS);

    expect(data).toEqual({
      tab: "count",
      yearCounts: [{ year: 2026, entryCount: 2, months: [{ month: 3, entryCount: 2 }] }],
    });
    expect(calls).toEqual(["years"]);
  });

  it("ranks words honouring the limit and the exclusions", () => {
    const { repo, calls } = fakeRepo([
      entry(1, "Sunny beach", "beach walk with the dog"),
      entry(2, "Rainy day", "dog stayed in, beach later"),
    ]);
    const data = loadJournalStatsTab(repo, "words", { topWordLimit: 2, excludedWords: ["dog"] });

    expect(calls).toEqual(["entries"]);
    expect(data.tab).toBe("words");
    if (data.tab !== "words") return;
    expect(data.limit).toBe(2);
    expect(data.words).toHaveLength(2);
    expect(data.words[0]).toEqual({ word: "beach", count: 3 });
    expect(data.words.map((row) => row.word)).not.toContain("dog");
  });

  it("rejects an unknown tab key without reading anything", () => {
    const { repo, calls } = fakeRepo();
    expect(() => loadJournalStatsTab(repo, "bogus", OPTIONS)).toThrow();
    expect(() => loadJournalStatsTab(repo, undefined, OPTIONS)).toThrow();
    expect(calls).toEqual([]);
  });
});
