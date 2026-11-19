import { describe, expect, it } from "vitest";
import { isLexiconWord, lexiconNode, parseLexicon } from "./word-wizard-lexicon";

describe("parseLexicon", () => {
  it("accepts unsorted, mixed-case lines and skips what is not a word", () => {
    const lexicon = parseLexicon("cats\r\nCAT\n\nat\nx\nhyphen-ated\ncat\nzebra\n");
    expect(lexicon.size).toBe(4);
    expect(isLexiconWord(lexicon, "cat")).toBe(true);
    expect(isLexiconWord(lexicon, "CATS")).toBe(true);
    expect(isLexiconWord(lexicon, "AT")).toBe(true);
    expect(isLexiconWord(lexicon, "ZEBRA")).toBe(true);
  });

  it("answers no for prefixes, unknown words and bad input", () => {
    const lexicon = parseLexicon("cats\nzebra");
    expect(isLexiconWord(lexicon, "CA")).toBe(false);
    expect(isLexiconWord(lexicon, "DOG")).toBe(false);
    expect(isLexiconWord(lexicon, "")).toBe(false);
    expect(isLexiconWord(lexicon, "CAT5")).toBe(false);
  });

  it("finds prefixes for the bot's search", () => {
    const lexicon = parseLexicon("quiz\nquit\nzebra");
    expect(lexiconNode(lexicon, "QUI")).toBeGreaterThan(0);
    expect(lexiconNode(lexicon, "QX")).toBe(-1);
  });

  it("builds an empty lexicon from empty text", () => {
    const lexicon = parseLexicon("");
    expect(lexicon.size).toBe(0);
    expect(isLexiconWord(lexicon, "AT")).toBe(false);
  });
});
