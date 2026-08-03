import { describe, expect, it } from "vitest";
import {
  aggregate,
  compareValues,
  computePageSlice,
  matchesFilter,
  matchesSearch,
  parseFilterExpression,
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

  it("compares numerically for > and <", () => {
    expect(matchesFilter(150, ">100")).toBe(true);
    expect(matchesFilter(50, ">100")).toBe(false);
    expect(matchesFilter(50, "<100")).toBe(true);
    // The boundary itself is excluded by the strict forms, included by >= / <=.
    expect(matchesFilter(100, ">100")).toBe(false);
    expect(matchesFilter(100, ">=100")).toBe(true);
    expect(matchesFilter(100, "<=100")).toBe(true);
  });

  it("compares a numeric string in a text column numerically, not lexically", () => {
    // "9" > "100" as text; the filter must not fall for that.
    expect(matchesFilter("9", "<100")).toBe(true);
    expect(matchesFilter("1200", ">1000")).toBe(true);
  });

  it("ignores thousands separators on both sides", () => {
    expect(matchesFilter(1500, ">1,000")).toBe(true);
    expect(matchesFilter("1,500", ">1000")).toBe(true);
  });

  it("compares ISO dates with the same operators", () => {
    expect(matchesFilter("2026-07-15", ">=2026-07-01")).toBe(true);
    expect(matchesFilter("2026-06-30", ">=2026-07-01")).toBe(false);
  });

  it("handles negative amounts, e.g. finding refunds", () => {
    expect(matchesFilter(-4500, "<0")).toBe(true);
    expect(matchesFilter(2033, "<0")).toBe(false);
  });

  it("treats an inclusive range at both ends", () => {
    expect(matchesFilter(100, "100..200")).toBe(true);
    expect(matchesFilter(200, "100..200")).toBe(true);
    expect(matchesFilter(250, "100..200")).toBe(false);
    expect(matchesFilter("2026-07-15", "2026-07-01..2026-07-31")).toBe(true);
    expect(matchesFilter("2026-08-01", "2026-07-01..2026-07-31")).toBe(false);
  });

  it("constrains only the end that an open-ended range gives", () => {
    expect(matchesFilter(5000, "100..")).toBe(true);
    expect(matchesFilter(50, "100..")).toBe(false);
    expect(matchesFilter(50, "..100")).toBe(true);
    expect(matchesFilter(500, "..100")).toBe(false);
  });

  it("supports exact match and exclusion", () => {
    expect(matchesFilter("new", "=new")).toBe(true);
    expect(matchesFilter("renewed", "=new")).toBe(false); // contains would match
    expect(matchesFilter("renewed", "new")).toBe(true);
    expect(matchesFilter("reconciled", "!=new")).toBe(true);
    expect(matchesFilter("new", "!=new")).toBe(false);
  });

  it("never lets a null satisfy a comparison", () => {
    expect(matchesFilter(null, ">0")).toBe(false);
    expect(matchesFilter(null, "<0")).toBe(false);
    expect(matchesFilter(null, "1..2")).toBe(false);
  });

  it("keeps the grid full while an operator is still being typed", () => {
    for (const partial of [">", ">=", "<", "!=", "=", ".."]) {
      expect(matchesFilter("anything", partial)).toBe(true);
      expect(matchesFilter(42, partial)).toBe(true);
    }
  });

  it("does not read a decimal as a range", () => {
    expect(matchesFilter(1.5, "1.5")).toBe(true);
    expect(matchesFilter(1.5, ">1.4")).toBe(true);
  });

  it("compares text bounds as text", () => {
    expect(matchesFilter("banana", ">apple")).toBe(true);
    expect(matchesFilter("apple", ">banana")).toBe(false);
  });
});

describe("parseFilterExpression", () => {
  it("reads each operator form", () => {
    expect(parseFilterExpression("")).toEqual({ kind: "all" });
    expect(parseFilterExpression("  ")).toEqual({ kind: "all" });
    expect(parseFilterExpression("smith")).toEqual({ kind: "contains", text: "smith" });
    expect(parseFilterExpression(">= 100")).toEqual({ kind: "gte", bound: 100 });
    expect(parseFilterExpression("<5")).toEqual({ kind: "lt", bound: 5 });
    expect(parseFilterExpression("!=New")).toEqual({ kind: "ne", text: "new" });
    expect(parseFilterExpression("=New")).toEqual({ kind: "eq", text: "new" });
    expect(parseFilterExpression("1..9")).toEqual({ kind: "range", from: 1, to: 9 });
  });

  it("lowercases text bounds so matching is case-insensitive", () => {
    expect(parseFilterExpression(">Apple")).toEqual({ kind: "gt", bound: "apple" });
  });
});

describe("aggregate", () => {
  it("sums, averages, and takes the extremes", () => {
    const values = [10, 20, 30];
    expect(aggregate(values, "sum")).toBe(60);
    expect(aggregate(values, "avg")).toBe(20);
    expect(aggregate(values, "min")).toBe(10);
    expect(aggregate(values, "max")).toBe(30);
  });

  it("skips nulls rather than counting them as zero", () => {
    expect(aggregate([10, null, 30], "sum")).toBe(40);
    expect(aggregate([10, null, 30], "avg")).toBe(20); // not 13.33
  });

  it("counts the non-null values", () => {
    expect(aggregate([10, null, "text", 30], "count")).toBe(3);
    expect(aggregate([null, null], "count")).toBe(0);
  });

  it("ignores values that are not numbers instead of returning NaN", () => {
    expect(aggregate([10, "n/a", 30], "sum")).toBe(40);
  });

  it("reads numeric strings, including thousands separators", () => {
    expect(aggregate(["1,000", "500"], "sum")).toBe(1500);
  });

  it("handles negatives, so refunds offset charges", () => {
    expect(aggregate([2033, -4500], "sum")).toBe(-2467);
  });

  it("returns null when there is nothing numeric to report", () => {
    expect(aggregate([], "sum")).toBeNull();
    expect(aggregate([null, "text"], "avg")).toBeNull();
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
