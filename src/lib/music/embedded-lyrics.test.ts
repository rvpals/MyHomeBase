import { describe, expect, it } from "vitest";
import { normaliseEmbeddedLyrics, pickEmbeddedLyrics } from "./embedded-lyrics";

describe("normaliseEmbeddedLyrics", () => {
  it("returns plain prose unchanged", () => {
    expect(normaliseEmbeddedLyrics("All the pretty stars\nShine for you")).toBe(
      "All the pretty stars\nShine for you",
    );
  });

  it("strips LRC timestamps from each line", () => {
    const raw = "[00:12.34]All the pretty stars\n[00:16.78]Shine for you";
    expect(normaliseEmbeddedLyrics(raw)).toBe("All the pretty stars\nShine for you");
  });

  it("accepts the colon form of the fractional part", () => {
    expect(normaliseEmbeddedLyrics("[01:02:50]Beautiful and broken")).toBe("Beautiful and broken");
  });

  it("drops LRC header metadata lines", () => {
    const raw = "[ar:Lana Del Rey]\n[ti:Beautiful]\n[offset:+200]\n[00:01.00]The words";
    expect(normaliseEmbeddedLyrics(raw)).toBe("The words");
  });

  it("keeps bracketed section labels, which are not metadata", () => {
    // `[Chorus]` has no colon, so it is a label the listener wants, not an LRC header.
    expect(normaliseEmbeddedLyrics("[Chorus]\nShine for you")).toBe("[Chorus]\nShine for you");
  });

  it("normalises CRLF and lone CR to newlines", () => {
    expect(normaliseEmbeddedLyrics("one\r\ntwo\rthree")).toBe("one\ntwo\nthree");
  });

  it("trims padding lines but keeps a blank line between verses", () => {
    expect(normaliseEmbeddedLyrics("\n\nfirst verse\n\nsecond verse\n\n")).toBe(
      "first verse\n\nsecond verse",
    );
  });

  it("treats an absent tag as undefined", () => {
    expect(normaliseEmbeddedLyrics(undefined)).toBeUndefined();
  });

  it("treats a blank tag as undefined rather than empty words", () => {
    expect(normaliseEmbeddedLyrics("   \n\t\n  ")).toBeUndefined();
  });

  it("treats a tag of nothing but timestamps as undefined", () => {
    expect(normaliseEmbeddedLyrics("[00:01.00]\n[00:02.00]")).toBeUndefined();
  });

  it("treats a tag of nothing but LRC metadata as undefined", () => {
    expect(normaliseEmbeddedLyrics("[ar:Someone]\n[ti:Something]")).toBeUndefined();
  });
});

describe("pickEmbeddedLyrics", () => {
  it("reads an un-synchronised frame", () => {
    expect(pickEmbeddedLyrics([{ text: "The words" }])).toBe("The words");
  });

  it("skips a blank frame and takes the next real one", () => {
    expect(pickEmbeddedLyrics([{ text: "  " }, { text: "The words" }])).toBe("The words");
  });

  it("falls back to a synchronised frame's lines when there is no plain text", () => {
    const tags = [{ syncText: [{ text: "All the pretty stars" }, { text: "Shine for you" }] }];
    expect(pickEmbeddedLyrics(tags)).toBe("All the pretty stars\nShine for you");
  });

  it("prefers plain text over synchronised text in the same frame", () => {
    const tags = [{ text: "The plain words", syncText: [{ text: "The synced words" }] }];
    expect(pickEmbeddedLyrics(tags)).toBe("The plain words");
  });

  it("returns undefined for no tags at all", () => {
    expect(pickEmbeddedLyrics(undefined)).toBeUndefined();
    expect(pickEmbeddedLyrics([])).toBeUndefined();
  });

  it("returns undefined when every frame is empty", () => {
    expect(pickEmbeddedLyrics([{ text: "" }, { syncText: [] }, {}])).toBeUndefined();
  });
});
