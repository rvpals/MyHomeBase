import { describe, expect, it } from "vitest";
import { PICTIONARY_WORDS, allWords, pickWord, tierSize, wordsInTier } from "./pictionary-words";
import { PICTIONARY_TIERS } from "./types";

describe("the word bank", () => {
  it("has words in every tier", () => {
    for (const tier of PICTIONARY_TIERS) {
      expect(tierSize(tier)).toBeGreaterThan(0);
    }
  });

  it("never repeats a word, within a tier or across them", () => {
    const words = allWords().map((entry) => entry.word);
    expect(new Set(words).size).toBe(words.length);
  });

  it("holds only drawable prompts — no letters, digits or punctuation to copy out", () => {
    // The one rule Pictionary has is that the drawer may not write. A prompt carrying a
    // digit or a hyphen invites them to draw the character instead of the idea.
    for (const { word } of allWords()) {
      expect(word).toMatch(/^[a-z]+( [a-z]+)*$/);
    }
  });

  it("tags each word with the tier it came from", () => {
    expect(wordsInTier("easy").every((entry) => entry.tier === "easy")).toBe(true);
    expect(wordsInTier("hard").every((entry) => entry.tier === "hard")).toBe(true);
  });

  it("covers every tier in allWords", () => {
    const total = PICTIONARY_TIERS.reduce((sum, tier) => sum + tierSize(tier), 0);
    expect(allWords()).toHaveLength(total);
  });
});

describe("pickWord", () => {
  it("picks from the requested tier", () => {
    const picked = pickWord("medium", [], () => 0);
    expect(PICTIONARY_WORDS.medium).toContain(picked.word);
    expect(picked.tier).toBe("medium");
  });

  it("picks the first unused word when the RNG floors", () => {
    expect(pickWord("easy", [], () => 0).word).toBe(PICTIONARY_WORDS.easy[0]);
  });

  it("skips words already used", () => {
    const [first, second] = PICTIONARY_WORDS.easy;
    expect(pickWord("easy", [first], () => 0).word).toBe(second);
  });

  it("stays in range when the RNG returns its upper bound", () => {
    // Math.random() never returns 1, but a stub might; the index must not run off the end.
    const picked = pickWord("hard", [], () => 0.999999999);
    expect(PICTIONARY_WORDS.hard).toContain(picked.word);
  });

  it("recycles rather than failing once every word has been used", () => {
    const all = [...PICTIONARY_WORDS.easy];
    const picked = pickWord("easy", all, () => 0);
    expect(all).toContain(picked.word);
  });
});
