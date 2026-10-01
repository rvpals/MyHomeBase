import { describe, expect, it } from "vitest";
import {
  normalizeExcludedWord,
  parseExcludedWords,
  serializeExcludedWords,
  tokenizeWords,
  topWords,
} from "./word-stats";
import type { JournalEntry } from "./types";

/** A minimal entry — only the two fields `topWords` reads carry meaning. */
function entry(title: string, content: string, id = 1): JournalEntry {
  return {
    id,
    date: "2026-07-27",
    time: "",
    title,
    content,
    placeName: "",
    isPinned: false,
    isLocked: false,
    categories: [],
    tags: [],
    locations: [],
    source: "",
    externalId: "",
    externalContent: "",
    createdAt: "2026-07-27T00:00:00Z",
    updatedAt: "2026-07-27T00:00:00Z",
  };
}

describe("tokenizeWords", () => {
  it("lowercases and splits on punctuation", () => {
    expect(tokenizeWords("Beach trip! Sandcastles, sunburn.")).toEqual([
      "beach",
      "trip",
      "sandcastles",
      "sunburn",
    ]);
  });

  it("treats differently-cased spellings as one word", () => {
    expect(tokenizeWords("Beach beach BEACH")).toEqual(["beach", "beach", "beach"]);
  });

  it("drops stopwords and anything under three letters", () => {
    // "was", "the" and "and" are listed; "a", "it", "so" fall to the length floor.
    expect(tokenizeWords("it was a very good day and so the picnic")).toEqual(["picnic"]);
  });

  it("keeps an apostrophe inside a word but strips the possessive", () => {
    // Without the internal-apostrophe rule this would split into "don"+"t".
    expect(tokenizeWords("don't touch mum's cake")).toEqual(["don't", "mum", "cake"]);
  });

  it("strips surrounding quotes without eating the word", () => {
    expect(tokenizeWords("'quoted' words")).toEqual(["quoted", "words"]);
  });

  it("excludes numbers and tokens containing digits", () => {
    expect(tokenizeWords("ran 5km in 2024 today")).toEqual(["ran"]);
  });

  it("returns nothing for empty or punctuation-only text", () => {
    expect(tokenizeWords("")).toEqual([]);
    expect(tokenizeWords("--- ... !!!")).toEqual([]);
  });
});

describe("topWords", () => {
  it("ranks words by total occurrences, most used first", () => {
    const entries = [
      entry("Beach", "beach beach picnic picnic sunburn", 1),
      entry("Picnic", "beach", 2),
    ];
    // beach: 2 in title/content of #1 body + 1 title + 1 in #2 = 4
    expect(topWords(entries, 3)).toEqual([
      { word: "beach", count: 4 },
      { word: "picnic", count: 3 },
      { word: "sunburn", count: 1 },
    ]);
  });

  it("counts repeats within one entry, not entries containing the word", () => {
    expect(topWords([entry("", "kayak kayak kayak")], 1)).toEqual([{ word: "kayak", count: 3 }]);
  });

  it("counts words that appear only in a title", () => {
    expect(topWords([entry("Kayaking", "")], 1)).toEqual([{ word: "kayaking", count: 1 }]);
  });

  it("does not fuse the last title word with the first content word", () => {
    const ranked = topWords([entry("beach", "trip")], 5);
    expect(ranked.map((row) => row.word)).toEqual(["beach", "trip"]);
  });

  it("breaks ties alphabetically so the order is stable", () => {
    const ranked = topWords([entry("", "zebra apple mango")], 3);
    expect(ranked).toEqual([
      { word: "apple", count: 1 },
      { word: "mango", count: 1 },
      { word: "zebra", count: 1 },
    ]);
  });

  it("honours the limit", () => {
    expect(topWords([entry("", "one two three four five six seven")], 2)).toHaveLength(2);
  });

  it("returns fewer than the limit when the journal has fewer distinct words", () => {
    expect(topWords([entry("", "kayak canoe")], 10)).toHaveLength(2);
  });

  it("returns an empty list for an empty journal", () => {
    expect(topWords([], 10)).toEqual([]);
  });

  it("returns an empty list when every word is filtered out", () => {
    expect(topWords([entry("The Day", "it was a very good day today")], 10)).toEqual([]);
  });

  it("returns an empty list for a non-positive limit", () => {
    const entries = [entry("", "kayak")];
    expect(topWords(entries, 0)).toEqual([]);
    expect(topWords(entries, -5)).toEqual([]);
  });
});

describe("normalizeExcludedWord", () => {
  it("lowercases and trims", () => {
    expect(normalizeExcludedWord("  Beach  ")).toBe("beach");
  });

  it("strips surrounding quotes and a possessive tail", () => {
    expect(normalizeExcludedWord("'mum's'")).toBe("mum");
  });

  it("keeps an internal apostrophe", () => {
    expect(normalizeExcludedWord("don't")).toBe("don't");
  });

  it("rejects anything too short to ever be ranked", () => {
    expect(normalizeExcludedWord("it")).toBe("");
    expect(normalizeExcludedWord("")).toBe("");
    expect(normalizeExcludedWord("   ")).toBe("");
  });

  it("rejects words the tokenizer could never emit", () => {
    // Digits and punctuation never survive tokenization, so storing them would
    // leave a row that can never match.
    expect(normalizeExcludedWord("2024")).toBe("");
    expect(normalizeExcludedWord("5km")).toBe("");
    expect(normalizeExcludedWord("beach!")).toBe("");
  });
});

describe("parseExcludedWords", () => {
  it("splits, normalizes and preserves first-seen order", () => {
    expect(parseExcludedWords("Beach, picnic ,KAYAK")).toEqual(["beach", "picnic", "kayak"]);
  });

  it("drops blanks, duplicates and unusable entries", () => {
    expect(parseExcludedWords("beach,,beach, it ,2024,picnic")).toEqual(["beach", "picnic"]);
  });

  it("returns an empty list for an empty or junk value", () => {
    expect(parseExcludedWords("")).toEqual([]);
    expect(parseExcludedWords(",,,")).toEqual([]);
  });
});

describe("serializeExcludedWords", () => {
  it("round-trips through parse", () => {
    expect(serializeExcludedWords(["Beach", "picnic"])).toBe("beach,picnic");
    expect(parseExcludedWords(serializeExcludedWords(["Beach", "picnic"]))).toEqual([
      "beach",
      "picnic",
    ]);
  });

  it("dedupes and drops unusable words", () => {
    expect(serializeExcludedWords(["beach", "BEACH", "it", ""])).toBe("beach");
  });

  it("gives an empty string for an empty list", () => {
    // The caller must remove the settings row rather than store this — the
    // module-settings schema rejects an empty value.
    expect(serializeExcludedWords([])).toBe("");
  });
});

describe("topWords with excluded words", () => {
  it("drops an excluded word and promotes the next one", () => {
    const entries = [entry("", "beach beach beach picnic picnic kayak")];
    expect(topWords(entries, 2, ["beach"])).toEqual([
      { word: "picnic", count: 2 },
      { word: "kayak", count: 1 },
    ]);
  });

  it("matches an excluded word regardless of stored casing or spacing", () => {
    const entries = [entry("", "beach picnic")];
    expect(topWords(entries, 5, ["  BEACH "])).toEqual([{ word: "picnic", count: 1 }]);
  });

  it("ignores an excluded word that never appears", () => {
    const entries = [entry("", "beach picnic")];
    expect(topWords(entries, 5, ["kayak"])).toEqual([
      { word: "beach", count: 1 },
      { word: "picnic", count: 1 },
    ]);
  });

  it("behaves as before for an empty exclusion list", () => {
    const entries = [entry("", "beach picnic")];
    expect(topWords(entries, 5, [])).toEqual(topWords(entries, 5));
  });

  it("can empty the list entirely", () => {
    expect(topWords([entry("", "beach")], 5, ["beach"])).toEqual([]);
  });
});
