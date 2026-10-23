import { describe, expect, it } from "vitest";
import {
  acronymOf,
  containsTermAsWords,
  normalizeTerm,
  normalizeWords,
  termSimilarity,
  trigramSimilarity,
  trigrams,
} from "./fuzzy";

describe("normalizeTerm", () => {
  it("strips punctuation so a dotted acronym matches a bare one", () => {
    expect(normalizeTerm("H.S.A.")).toBe("hsa");
    expect(normalizeTerm("HSA")).toBe("hsa");
    expect(normalizeTerm("h s a")).toBe("hsa");
  });

  it("returns an empty string for input with nothing alphanumeric", () => {
    expect(normalizeTerm("—  …!")).toBe("");
    expect(normalizeTerm("")).toBe("");
  });
});

describe("normalizeWords", () => {
  it("splits on punctuation and drops empties", () => {
    expect(normalizeWords("Health  Savings, Account!")).toEqual([
      "health",
      "savings",
      "account",
    ]);
  });

  it("returns an empty list when there are no words", () => {
    expect(normalizeWords("***")).toEqual([]);
  });
});

describe("acronymOf", () => {
  it("takes the initials of a multi-word phrase", () => {
    expect(acronymOf("Health Savings Account")).toBe("hsa");
  });

  it("returns empty for a single word, which has no meaningful acronym", () => {
    expect(acronymOf("Health")).toBe("");
    expect(acronymOf("")).toBe("");
  });
});

describe("trigrams", () => {
  it("pads so the first and last characters are counted", () => {
    expect(trigrams("ab")).toEqual(new Set(["  a", " ab", "ab "]));
  });
});

describe("trigramSimilarity", () => {
  it("scores an identical string as 1", () => {
    expect(trigramSimilarity("hsa", "hsa")).toBe(1);
  });

  it("scores unrelated strings near 0", () => {
    expect(trigramSimilarity("hsa", "zzzzzz")).toBe(0);
  });

  it("scores a near-miss between 0 and 1", () => {
    const score = trigramSimilarity("savings", "saving");
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThan(1);
  });

  it("returns 0 when either side is empty", () => {
    expect(trigramSimilarity("", "hsa")).toBe(0);
    expect(trigramSimilarity("hsa", "")).toBe(0);
  });
});

describe("termSimilarity", () => {
  it("matches exactly, ignoring case and punctuation", () => {
    expect(termSimilarity("HSA", "hsa")).toBe(1);
    expect(termSimilarity("HSA", "H.S.A.")).toBe(1);
  });

  it("matches a term against the acronym of a phrase", () => {
    expect(termSimilarity("HSA", "Health Savings Account")).toBe(0.95);
  });

  it("matches a phrase against the acronym the reader typed out", () => {
    expect(termSimilarity("Health Savings Account", "HSA")).toBe(0.95);
  });

  it("ranks an exact tag above an expansion, so literal names lead", () => {
    expect(termSimilarity("HSA", "HSA")).toBeGreaterThan(
      termSimilarity("HSA", "Health Savings Account"),
    );
  });

  // The failure this threshold exists to prevent: short acronyms share
  // trigrams with ordinary words, and a loose cutoff fills the graph with them.
  it("does not fuzzy-match a short term against an unrelated word", () => {
    expect(termSimilarity("HSA", "Shasta")).toBe(0);
    expect(termSimilarity("HSA", "has a point")).toBe(0);
  });

  it("does fuzzy-match a longer term against a near spelling", () => {
    expect(termSimilarity("savings", "saving")).toBeGreaterThan(0);
  });

  it("returns 0 when either side normalizes to nothing", () => {
    expect(termSimilarity("", "HSA")).toBe(0);
    expect(termSimilarity("HSA", "!!!")).toBe(0);
  });

  it("respects a caller-supplied threshold", () => {
    // Loose enough to admit a weak pair that the default rejects.
    expect(termSimilarity("savings", "savers", 0.99)).toBe(0);
    expect(termSimilarity("savings", "savers", 0.1)).toBeGreaterThan(0);
  });
});

describe("containsTermAsWords", () => {
  it("finds the term as a whole word", () => {
    expect(containsTermAsWords("Filed the HSA claim today", "HSA")).toBe(true);
  });

  it("finds a multi-word term only when the words are adjacent", () => {
    expect(containsTermAsWords("my health savings account", "health savings")).toBe(true);
    expect(containsTermAsWords("health and savings", "health savings")).toBe(false);
  });

  // The reason this isn't a substring search.
  it("does not match the term inside a longer word", () => {
    expect(containsTermAsWords("we made a start", "art")).toBe(false);
    expect(containsTermAsWords("a party at heart", "art")).toBe(false);
  });

  it("ignores case and punctuation on both sides", () => {
    expect(containsTermAsWords("Filed the H.S.A. claim", "hsa")).toBe(true);
  });

  it("returns false for an empty term or a text shorter than it", () => {
    expect(containsTermAsWords("anything", "")).toBe(false);
    expect(containsTermAsWords("hsa", "health savings account")).toBe(false);
  });
});
