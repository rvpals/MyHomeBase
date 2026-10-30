import { describe, expect, it } from "vitest";
import {
  PICTIONARY_MAX_WORD_LENGTH,
  parseWordList,
  wordProblem,
} from "./pictionary-import";

describe("wordProblem", () => {
  it("accepts a plain word", () => {
    expect(wordProblem("volcano")).toBeUndefined();
  });

  it("accepts a two-word prompt", () => {
    expect(wordProblem("hot air balloon")).toBeUndefined();
  });

  it("accepts hyphens and apostrophes, which real words have", () => {
    expect(wordProblem("t-shirt")).toBeUndefined();
    expect(wordProblem("jack-o'-lantern")).toBeUndefined();
  });

  it("accepts letters outside ASCII, so another language can be imported", () => {
    expect(wordProblem("éléphant")).toBeUndefined();
    expect(wordProblem("日本")).toBeUndefined();
  });

  it("rejects an empty or whitespace-only value", () => {
    expect(wordProblem("")).toMatch(/empty/i);
    expect(wordProblem("   ")).toMatch(/empty/i);
  });

  it("rejects a digit, because a prompt must be drawable", () => {
    expect(wordProblem("area 51")).toMatch(/digit/i);
    expect(wordProblem("2048")).toMatch(/digit/i);
  });

  it("rejects punctuation that is not a hyphen or an apostrophe", () => {
    expect(wordProblem("what?")).toMatch(/other than letters/i);
    expect(wordProblem("a+b")).toMatch(/other than letters/i);
  });

  it("rejects a value that does not start with a letter", () => {
    expect(wordProblem("-house")).toMatch(/other than letters/i);
  });

  it("rejects a pasted paragraph", () => {
    expect(wordProblem("a".repeat(PICTIONARY_MAX_WORD_LENGTH + 1))).toMatch(/longer than/i);
  });

  it("accepts a word exactly at the limit", () => {
    expect(wordProblem("a".repeat(PICTIONARY_MAX_WORD_LENGTH))).toBeUndefined();
  });
});

describe("parseWordList", () => {
  it("reads one word per line", () => {
    const parsed = parseWordList("cat\ndog\nhouse", "easy");
    expect(parsed.words.map((entry) => entry.word)).toEqual(["cat", "dog", "house"]);
    expect(parsed.words.every((entry) => entry.tier === "easy")).toBe(true);
    expect(parsed.problems).toEqual([]);
  });

  it("reads a comma-separated run as several words", () => {
    const parsed = parseWordList("cat, dog, house", "medium");
    expect(parsed.words.map((entry) => entry.word)).toEqual(["cat", "dog", "house"]);
    expect(parsed.words.every((entry) => entry.tier === "medium")).toBe(true);
  });

  it("reads semicolons and tabs as separators too", () => {
    expect(parseWordList("cat;dog", "easy").words).toHaveLength(2);
    expect(parseWordList("cat\tdog", "easy").words).toHaveLength(2);
  });

  it("imports Windows and Unix line endings the same way", () => {
    expect(parseWordList("cat\r\ndog\r\nhouse", "easy").words).toHaveLength(3);
    expect(parseWordList("cat\rdog\rhouse", "easy").words).toHaveLength(3);
  });

  it("ignores blank lines rather than reporting them", () => {
    const parsed = parseWordList("cat\n\n\ndog\n   \n", "easy");
    expect(parsed.words).toHaveLength(2);
    expect(parsed.problems).toEqual([]);
  });

  it("lets a second column name the tier, overriding the default", () => {
    const parsed = parseWordList("volcano,hard\nball,easy", "medium");
    expect(parsed.words).toEqual([
      { word: "volcano", tier: "hard" },
      { word: "ball", tier: "easy" },
    ]);
  });

  it("falls back to the default tier for a row that names none", () => {
    const parsed = parseWordList("volcano,hard\nball", "medium");
    expect(parsed.words[1]).toEqual({ word: "ball", tier: "medium" });
  });

  it("treats an unknown tier name as a second word, not a tier", () => {
    // "impossible" is not a tier, so this line is a comma-separated run of two prompts.
    const parsed = parseWordList("volcano,impossible", "easy");
    expect(parsed.words.map((entry) => entry.word)).toEqual(["volcano", "impossible"]);
  });

  it("skips an exported CSV's header row", () => {
    const parsed = parseWordList("word,tier\ncat,easy\ndog,hard", "easy");
    expect(parsed.words).toEqual([
      { word: "cat", tier: "easy" },
      { word: "dog", tier: "hard" },
    ]);
  });

  it("keeps a first line that is a real word rather than a header", () => {
    // "word" alone could be either; with no column header beside it, it is a prompt.
    const parsed = parseWordList("cat\ndog", "easy");
    expect(parsed.words).toHaveLength(2);
  });

  it("only treats the first line as a header", () => {
    const parsed = parseWordList("cat\nword,tier", "easy");
    // The second line is not a header, so it parses as a word plus a named tier.
    expect(parsed.words.map((entry) => entry.word)).toEqual(["cat", "word"]);
  });

  it("collapses internal whitespace", () => {
    expect(parseWordList("hot   air  balloon", "medium").words[0].word).toBe("hot air balloon");
  });

  it("drops duplicates within one submission, case-insensitively", () => {
    const parsed = parseWordList("cat\nCat\nCAT\ndog", "easy");
    expect(parsed.words.map((entry) => entry.word)).toEqual(["cat", "dog"]);
    expect(parsed.duplicates).toBe(2);
  });

  it("keeps the same word in two different tiers", () => {
    const parsed = parseWordList("cat,easy\ncat,hard", "easy");
    expect(parsed.words).toHaveLength(2);
    expect(parsed.duplicates).toBe(0);
  });

  it("reports a bad row with its line number and reason", () => {
    const parsed = parseWordList("cat\narea 51\ndog", "easy");
    expect(parsed.words.map((entry) => entry.word)).toEqual(["cat", "dog"]);
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.problems[0].line).toBe(2);
    expect(parsed.problems[0].value).toBe("area 51");
    expect(parsed.problems[0].reason).toMatch(/digit/i);
  });

  it("imports the good rows from a mixed list rather than failing the lot", () => {
    const parsed = parseWordList("cat\n123\ndog\nwhat?\nhouse", "easy");
    expect(parsed.words).toHaveLength(3);
    expect(parsed.problems).toHaveLength(2);
  });

  it("returns nothing for empty input", () => {
    const parsed = parseWordList("", "easy");
    expect(parsed.words).toEqual([]);
    expect(parsed.problems).toEqual([]);
    expect(parsed.duplicates).toBe(0);
  });

  it("returns nothing for a file that is only a header", () => {
    expect(parseWordList("word,tier", "easy").words).toEqual([]);
  });
});
