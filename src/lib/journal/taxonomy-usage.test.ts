import { describe, expect, it } from "vitest";
import {
  findUnusedTaxonomy,
  normalizeTaxonomyName,
  taxonomyInUseAmong,
  taxonomyUsageCounts,
} from "./taxonomy-usage";
import type { JournalRepository } from "./ports";
import type { JournalCategory, JournalTag, JournalTaxonomyCount } from "./types";

// The four port methods these reads reach. Named explicitly for the same reason
// as ics-import.test.ts's fake: a bare literal cast to JournalRepository would
// leave the fake's own shape unchecked.
type UsageRepo = Pick<
  JournalRepository,
  "listCategories" | "listTags" | "countEntriesByCategory" | "countEntriesByTag"
>;

/** A managed row — only `name` carries meaning for these reads. */
function taxonomyRow(name: string): JournalCategory & JournalTag {
  return {
    name,
    description: "",
    iconMimeType: undefined,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * An in-memory repository over two managed lists and two sets of entry-side
 * counts. Mirrors the real repository's contract: managed names sorted by name,
 * entry counts keyed by the name exactly as stored on the entry row.
 */
function fakeRepo(data: {
  categories?: string[];
  tags?: string[];
  categoryCounts?: Record<string, number>;
  tagCounts?: Record<string, number>;
}): JournalRepository {
  const toCounts = (counts: Record<string, number>): JournalTaxonomyCount[] =>
    Object.entries(counts)
      .map(([name, entryCount]) => ({ name, entryCount }))
      .sort((a, b) => a.name.localeCompare(b.name));

  const repo: UsageRepo = {
    listCategories: () => (data.categories ?? []).map(taxonomyRow),
    listTags: () => (data.tags ?? []).map(taxonomyRow),
    countEntriesByCategory: () => toCounts(data.categoryCounts ?? {}),
    countEntriesByTag: () => toCounts(data.tagCounts ?? {}),
  };
  return repo as JournalRepository;
}

describe("normalizeTaxonomyName", () => {
  it("trims and lowercases, so differently-typed spellings compare alike", () => {
    expect(normalizeTaxonomyName("  Work ")).toBe("work");
    expect(normalizeTaxonomyName("WORK")).toBe(normalizeTaxonomyName("work"));
  });
});

describe("taxonomyUsageCounts", () => {
  it("pairs every managed category with its entry count", () => {
    const repo = fakeRepo({
      categories: ["Errands", "Travel", "Work"],
      categoryCounts: { Travel: 7, Work: 34 },
    });

    expect(taxonomyUsageCounts(repo, "category")).toEqual([
      { name: "Errands", entryCount: 0 },
      { name: "Travel", entryCount: 7 },
      { name: "Work", entryCount: 34 },
    ]);
  });

  it("reads the tag list when asked for tags", () => {
    const repo = fakeRepo({
      categories: ["Work"],
      categoryCounts: { Work: 34 },
      tags: ["beach", "picnic"],
      tagCounts: { beach: 2 },
    });

    expect(taxonomyUsageCounts(repo, "tag")).toEqual([
      { name: "beach", entryCount: 2 },
      { name: "picnic", entryCount: 0 },
    ]);
  });

  it("sums spellings that normalize alike onto the managed name", () => {
    // The case that makes the normalization load-bearing: entries filed under
    // "work" and "Work " are the same category everywhere else in the app, so
    // the managed "Work" must report all 9 — not 5, and certainly not 0.
    const repo = fakeRepo({
      categories: ["Work"],
      categoryCounts: { Work: 5, work: 3, "Work ": 1 },
    });

    expect(taxonomyUsageCounts(repo, "category")).toEqual([{ name: "Work", entryCount: 9 }]);
  });

  it("ignores entry-side names that are not in the managed list", () => {
    const repo = fakeRepo({
      categories: ["Work"],
      categoryCounts: { Work: 2, Orphaned: 5 },
    });

    expect(taxonomyUsageCounts(repo, "category")).toEqual([{ name: "Work", entryCount: 2 }]);
  });

  it("returns an empty list when nothing is managed", () => {
    expect(taxonomyUsageCounts(fakeRepo({}), "category")).toEqual([]);
    expect(taxonomyUsageCounts(fakeRepo({}), "tag")).toEqual([]);
  });
});

describe("findUnusedTaxonomy", () => {
  it("names only the managed rows no entry uses", () => {
    const repo = fakeRepo({
      categories: ["Errands", "Obsolete", "Travel", "Work"],
      categoryCounts: { Travel: 7, Work: 34 },
    });

    expect(findUnusedTaxonomy(repo, "category")).toEqual(["Errands", "Obsolete"]);
  });

  it("returns the name as stored in the managed list, not normalized", () => {
    // What the caller ticks on screen and passes to deleteCategory, so the
    // original casing has to survive the comparison.
    const repo = fakeRepo({ categories: ["Spring Cleaning"] });

    expect(findUnusedTaxonomy(repo, "category")).toEqual(["Spring Cleaning"]);
  });

  it("does not report a name used under a different casing", () => {
    // The failure path that would delete a live category.
    const repo = fakeRepo({ categories: ["Work"], categoryCounts: { work: 12 } });

    expect(findUnusedTaxonomy(repo, "category")).toEqual([]);
  });

  it("returns nothing when every managed name is in use", () => {
    const repo = fakeRepo({ tags: ["beach"], tagCounts: { beach: 1 } });

    expect(findUnusedTaxonomy(repo, "tag")).toEqual([]);
  });

  it("returns every name when there are no entries at all", () => {
    const repo = fakeRepo({ tags: ["beach", "picnic"] });

    expect(findUnusedTaxonomy(repo, "tag")).toEqual(["beach", "picnic"]);
  });
});

describe("taxonomyInUseAmong", () => {
  it("reports only the asked-for names that entries still carry, busiest first", () => {
    const repo = fakeRepo({
      categories: ["Errands", "Travel", "Work"],
      categoryCounts: { Travel: 7, Work: 34 },
    });

    expect(taxonomyInUseAmong(repo, "category", ["Errands", "Travel", "Work"])).toEqual([
      { name: "Work", entryCount: 34 },
      { name: "Travel", entryCount: 7 },
    ]);
  });

  it("leaves out in-use names the caller did not ask about", () => {
    const repo = fakeRepo({
      categories: ["Travel", "Work"],
      categoryCounts: { Travel: 7, Work: 34 },
    });

    expect(taxonomyInUseAmong(repo, "category", ["Travel"])).toEqual([
      { name: "Travel", entryCount: 7 },
    ]);
  });

  it("matches the asked-for names loosely, so a casing difference still warns", () => {
    const repo = fakeRepo({ categories: ["Work"], categoryCounts: { Work: 34 } });

    expect(taxonomyInUseAmong(repo, "category", ["work"])).toEqual([
      { name: "Work", entryCount: 34 },
    ]);
  });

  it("breaks an equal-count tie by name", () => {
    const repo = fakeRepo({
      tags: ["beach", "apple"],
      tagCounts: { beach: 3, apple: 3 },
    });

    expect(taxonomyInUseAmong(repo, "tag", ["beach", "apple"])).toEqual([
      { name: "apple", entryCount: 3 },
      { name: "beach", entryCount: 3 },
    ]);
  });

  it("returns nothing for an empty selection, or when none are in use", () => {
    const repo = fakeRepo({
      categories: ["Errands", "Work"],
      categoryCounts: { Work: 34 },
    });

    expect(taxonomyInUseAmong(repo, "category", [])).toEqual([]);
    expect(taxonomyInUseAmong(repo, "category", ["Errands"])).toEqual([]);
  });
});
