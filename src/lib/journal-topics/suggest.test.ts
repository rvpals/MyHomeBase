import { describe, expect, it } from "vitest";
import { suggestTopics } from "./suggest";
import type { JournalTaxonomyCount } from "@/lib/journal/types";

const tags: JournalTaxonomyCount[] = [
  { name: "HSA", entryCount: 12 },
  { name: "Garden", entryCount: 40 },
  { name: "Rare", entryCount: 1 },
];

const categories: JournalTaxonomyCount[] = [
  { name: "Health Savings Account", entryCount: 5 },
  { name: "Travel", entryCount: 25 },
];

describe("suggestTopics", () => {
  it("offers the most-used names first when nothing is typed", () => {
    const rows = suggestTopics(tags, categories);
    expect(rows.slice(0, 3).map((r) => r.name)).toEqual(["Garden", "Travel", "HSA"]);
  });

  it("labels each suggestion with the list it came from", () => {
    const rows = suggestTopics(tags, categories);
    expect(rows.find((r) => r.name === "Garden")?.kind).toBe("tag");
    expect(rows.find((r) => r.name === "Travel")?.kind).toBe("category");
  });

  it("narrows to fuzzy matches once a query is typed", () => {
    const rows = suggestTopics(tags, categories, { query: "hsa" });
    expect(rows.map((r) => r.name)).toEqual(["HSA", "Health Savings Account"]);
  });

  // A strong match on a small tag must beat a weak match on a huge one,
  // otherwise typing a specific term still surfaces the popular names.
  it("ranks by match strength before entry count", () => {
    const rows = suggestTopics(
      [{ name: "Garden", entryCount: 400 }],
      [{ name: "Health Savings Account", entryCount: 1 }],
      { query: "HSA" },
    );
    expect(rows.map((r) => r.name)).toEqual(["Health Savings Account"]);
  });

  it("respects the limit", () => {
    expect(suggestTopics(tags, categories, { limit: 2 })).toHaveLength(2);
    expect(suggestTopics(tags, categories, { query: "hsa", limit: 1 })).toHaveLength(1);
  });

  it("filters out names below the minimum entry count", () => {
    const rows = suggestTopics(tags, categories, { minEntryCount: 5 });
    expect(rows.map((r) => r.name)).not.toContain("Rare");
  });

  it("keeps single-entry names by default — a small topic is still a topic", () => {
    const rows = suggestTopics(tags, categories);
    expect(rows.map((r) => r.name)).toContain("Rare");
  });

  it("ignores blank names", () => {
    const rows = suggestTopics([{ name: "   ", entryCount: 99 }], []);
    expect(rows).toEqual([]);
  });

  it("returns nothing when the query matches nothing", () => {
    expect(suggestTopics(tags, categories, { query: "zzzzzzz" })).toEqual([]);
  });

  it("handles empty taxonomy lists", () => {
    expect(suggestTopics([], [])).toEqual([]);
    expect(suggestTopics([], [], { query: "hsa" })).toEqual([]);
  });

  it("treats a whitespace-only query as no query", () => {
    const rows = suggestTopics(tags, categories, { query: "   " });
    expect(rows[0].name).toBe("Garden");
  });
});
