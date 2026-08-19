import { describe, expect, it } from "vitest";
import {
  contentRangeHeader,
  parseRangeHeader,
  unsatisfiableContentRangeHeader,
} from "./range";

// Range handling is what makes seeking work, and on iOS Safari what makes audio
// play at all — it refuses a source whose server does not answer ranges. Every
// awkward header form is pinned here so it is never rediscovered on a phone.

const SIZE = 1000;

describe("parseRangeHeader", () => {
  it("serves the whole file when there is no Range header", () => {
    expect(parseRangeHeader(null, SIZE)).toEqual({ kind: "full" });
    expect(parseRangeHeader(undefined, SIZE)).toEqual({ kind: "full" });
    expect(parseRangeHeader("   ", SIZE)).toEqual({ kind: "full" });
  });

  it("reads an open-ended range, the usual opening request", () => {
    expect(parseRangeHeader("bytes=0-", SIZE)).toEqual({
      kind: "partial",
      range: { start: 0, end: 999, length: 1000 },
    });
  });

  it("reads an explicit window, which is what seeking sends", () => {
    expect(parseRangeHeader("bytes=500-999", SIZE)).toEqual({
      kind: "partial",
      range: { start: 500, end: 999, length: 500 },
    });
  });

  it("reads a suffix range, used to fetch trailing metadata", () => {
    expect(parseRangeHeader("bytes=-500", SIZE)).toEqual({
      kind: "partial",
      range: { start: 500, end: 999, length: 500 },
    });
  });

  it("clamps a suffix longer than the file to the whole file", () => {
    expect(parseRangeHeader("bytes=-5000", SIZE)).toEqual({
      kind: "partial",
      range: { start: 0, end: 999, length: 1000 },
    });
  });

  it("clamps an end past the last byte", () => {
    expect(parseRangeHeader("bytes=900-99999", SIZE)).toEqual({
      kind: "partial",
      range: { start: 900, end: 999, length: 100 },
    });
  });

  it("handles a single-byte range at the last byte", () => {
    expect(parseRangeHeader("bytes=999-999", SIZE)).toEqual({
      kind: "partial",
      range: { start: 999, end: 999, length: 1 },
    });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseRangeHeader("  bytes=0-99  ", SIZE)).toEqual({
      kind: "partial",
      range: { start: 0, end: 99, length: 100 },
    });
  });

  // --- the 416 cases: these must NOT come back as a 200 ---

  it("reports a start at or past the end as unsatisfiable", () => {
    expect(parseRangeHeader("bytes=1000-", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseRangeHeader("bytes=5000-6000", SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  it("reports a zero-length suffix as unsatisfiable", () => {
    expect(parseRangeHeader("bytes=-0", SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  it("reports any range against an empty file as unsatisfiable", () => {
    expect(parseRangeHeader("bytes=0-", 0)).toEqual({ kind: "unsatisfiable" });
  });

  // --- malformed: RFC 7233 says ignore, so serve the whole file ---

  it("ignores a unit it does not implement", () => {
    expect(parseRangeHeader("items=0-99", SIZE)).toEqual({ kind: "full" });
    expect(parseRangeHeader("bytes 0-99", SIZE)).toEqual({ kind: "full" });
  });

  it("ignores multi-range, which would need a multipart response", () => {
    expect(parseRangeHeader("bytes=0-99,200-299", SIZE)).toEqual({ kind: "full" });
  });

  it("ignores a backwards range", () => {
    expect(parseRangeHeader("bytes=500-100", SIZE)).toEqual({ kind: "full" });
  });

  it("ignores a range with neither bound", () => {
    expect(parseRangeHeader("bytes=-", SIZE)).toEqual({ kind: "full" });
  });

  it("ignores non-numeric bounds rather than coercing them", () => {
    expect(parseRangeHeader("bytes=abc-def", SIZE)).toEqual({ kind: "full" });
    // Would be NaN if it slipped through the pattern.
    expect(parseRangeHeader("bytes=1e2-200", SIZE)).toEqual({ kind: "full" });
  });
});

describe("contentRangeHeader", () => {
  it("states the served window and the full size", () => {
    expect(contentRangeHeader({ start: 500, end: 999, length: 500 }, SIZE)).toBe(
      "bytes 500-999/1000",
    );
  });

  it("states the real size on a 416 so a client can retry sensibly", () => {
    expect(unsatisfiableContentRangeHeader(SIZE)).toBe("bytes */1000");
  });
});
