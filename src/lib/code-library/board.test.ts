import { describe, expect, it } from "vitest";
import { dealIntoColumns, estimateSnippetCardHeight } from "./board";
import type { SnippetSummary } from "./types";

function summary(over: Partial<SnippetSummary> = {}): SnippetSummary {
  return {
    id: 1,
    title: "",
    preview: "a",
    code: "a",
    language: "ts",
    lineCount: 1,
    categories: [],
    tags: [],
    isPinned: false,
    color: "",
    sourceUrl: "",
    notes: "",
    isEncrypted: false,
    passwordHint: "",
    createdBy: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

describe("dealIntoColumns", () => {
  it("always returns exactly the requested number of columns", () => {
    // Two items into three columns must give one empty column, not two columns
    // — otherwise the grid's widths change with the item count.
    const columns = dealIntoColumns([1, 2], 3, () => 1);
    expect(columns).toHaveLength(3);
    expect(columns[2]).toEqual([]);
  });

  it("degenerates to round-robin when every weight is equal", () => {
    // Ties take the leftmost column, which is what keeps a short board reading
    // left-to-right.
    const columns = dealIntoColumns([1, 2, 3, 4], 2, () => 1);
    expect(columns).toEqual([
      [1, 3],
      [2, 4],
    ]);
  });

  it("puts the next item in the shortest column", () => {
    // One tall item then three short ones: the tall one should not be joined
    // until the other column has caught up.
    const columns = dealIntoColumns([10, 1, 1, 1], 2, (n) => n);
    expect(columns[0]).toEqual([10]);
    expect(columns[1]).toEqual([1, 1, 1]);
  });

  it("survives a zero or negative column count rather than throwing", () => {
    // Layout, not data integrity — drawing one column beats refusing to draw.
    expect(dealIntoColumns([1, 2], 0, () => 1)).toEqual([[1, 2]]);
    expect(dealIntoColumns([1, 2], -3, () => 1)).toEqual([[1, 2]]);
  });

  it("returns empty columns for no items", () => {
    expect(dealIntoColumns([], 2, () => 1)).toEqual([[], []]);
  });
});

describe("estimateSnippetCardHeight", () => {
  it("grows with the preview's line count", () => {
    const short = estimateSnippetCardHeight(summary({ preview: "a" }));
    const long = estimateSnippetCardHeight(summary({ preview: "a\nb\nc\nd\ne\nf" }));
    expect(long).toBeGreaterThan(short);
  });

  it("treats a sealed snippet as nearly the shortest card", () => {
    // It renders a one-line placeholder, not a code block. Getting this wrong
    // leaves a column of sealed cards looking oddly short.
    const sealed = estimateSnippetCardHeight(
      summary({ isEncrypted: true, preview: "", code: "" }),
    );
    const open = estimateSnippetCardHeight(summary({ preview: "a\nb\nc\nd\ne\nf" }));
    expect(sealed).toBeLessThan(open);
  });

  it("counts the rows that labels, notes and a source link each add", () => {
    const bare = estimateSnippetCardHeight(summary());
    const dressed = estimateSnippetCardHeight(
      summary({ tags: ["x"], notes: "why", sourceUrl: "https://example.com" }),
    );
    expect(dressed).toBeGreaterThan(bare);
  });

  it("never returns zero, so a column of empty snippets still balances", () => {
    expect(estimateSnippetCardHeight(summary({ preview: "", code: "" }))).toBeGreaterThan(0);
  });
});
