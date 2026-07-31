import { describe, expect, it } from "vitest";
import {
  compareValues,
  computePageSlice,
  matchesFilter,
  matchesSearch,
  sortRows,
  toCsv,
  toCsvField,
} from "./table";

describe("compareValues", () => {
  it("compares numbers numerically", () => {
    expect(compareValues(2, 10)).toBeLessThan(0);
  });

  it("compares text with natural number ordering", () => {
    expect(compareValues("item 2", "item 10")).toBeLessThan(0);
  });

  it("sorts nulls last in either direction", () => {
    expect(compareValues(null, "a")).toBeGreaterThan(0);
    expect(compareValues("a", null)).toBeLessThan(0);
    expect(compareValues(null, null)).toBe(0);
  });
});

describe("sortRows", () => {
  const rows = [{ n: 3 }, { n: 1 }, { n: 2 }];

  it("sorts ascending and descending without mutating the input", () => {
    const ascending = sortRows(rows, (row) => row.n, "asc");
    expect(ascending.map((row) => row.n)).toEqual([1, 2, 3]);
    expect(sortRows(rows, (row) => row.n, "desc").map((row) => row.n)).toEqual([3, 2, 1]);
    expect(rows.map((row) => row.n)).toEqual([3, 1, 2]); // untouched
  });
});

describe("matchesSearch", () => {
  const values = ["Neurologist Dr Hersh", "MEDICAL", 42, null];

  it("matches a case-insensitive substring in any value", () => {
    expect(matchesSearch(values, "hersh")).toBe(true);
    expect(matchesSearch(values, "MEDICAL")).toBe(true);
    expect(matchesSearch(values, "42")).toBe(true);
  });

  it("ANDs multiple terms across different values", () => {
    expect(matchesSearch(values, "hersh medical")).toBe(true);
    expect(matchesSearch(values, "hersh dentist")).toBe(false);
  });

  it("matches everything for a blank query", () => {
    expect(matchesSearch(values, "   ")).toBe(true);
  });

  it("does not crash on null values", () => {
    expect(matchesSearch([null], "anything")).toBe(false);
  });
});

describe("matchesFilter", () => {
  it("matches a substring, ignoring case and surrounding space", () => {
    expect(matchesFilter("Princeton, NJ", " princeton ")).toBe(true);
    expect(matchesFilter("Princeton, NJ", "boston")).toBe(false);
  });

  it("matches everything for a blank filter", () => {
    expect(matchesFilter(null, "")).toBe(true);
  });
});

describe("computePageSlice", () => {
  it("slices a middle page", () => {
    expect(computePageSlice(250, 100, 1)).toEqual({
      page: 1,
      totalPages: 3,
      startIndex: 100,
      endIndex: 200,
    });
  });

  it("clamps a page beyond the end (e.g. after filtering shrinks the set)", () => {
    const slice = computePageSlice(30, 25, 9);
    expect(slice.page).toBe(1);
    expect(slice.startIndex).toBe(25);
    expect(slice.endIndex).toBe(30);
  });

  it("treats ALL as a single page", () => {
    expect(computePageSlice(500, "ALL", 3)).toEqual({
      page: 0,
      totalPages: 1,
      startIndex: 0,
      endIndex: 500,
    });
  });

  it("handles an empty set", () => {
    expect(computePageSlice(0, 25, 0)).toEqual({
      page: 0,
      totalPages: 1,
      startIndex: 0,
      endIndex: 0,
    });
  });
});

describe("toCsvField / toCsv", () => {
  it("quotes only values containing a comma, quote, or newline", () => {
    expect(toCsvField("plain")).toBe("plain");
    expect(toCsvField("has,comma")).toBe('"has,comma"');
    expect(toCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(toCsvField(null)).toBe("");
  });

  it("builds CRLF-separated CSV text", () => {
    expect(toCsv(["a", "b"], [[1, "x"], [2, null]])).toBe("a,b\r\n1,x\r\n2,");
  });
});
