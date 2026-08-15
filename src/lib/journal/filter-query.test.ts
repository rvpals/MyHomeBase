import { describe, expect, it } from "vitest";
import { FilterQueryError, parseFilterQuery, tryParseFilterQuery } from "./filter-query";
import { buildFilterSql, describeFilter } from "./filters";

describe("parseFilterQuery — single conditions", () => {
  it("parses an exact taxonomy match as hasAny", () => {
    expect(parseFilterQuery("category = TRIP")).toEqual({
      join: "AND",
      groups: [{ join: "AND", conditions: [{ field: "category", operator: "hasAny", values: ["TRIP"] }] }],
    });
  });

  it("treats a comma list as any-of", () => {
    const filter = parseFilterQuery("category = TRIP, FAMILY");
    expect(filter.groups[0].conditions[0].values).toEqual(["TRIP", "FAMILY"]);
  });

  it("maps != on a taxonomy to hasNone", () => {
    expect(parseFilterQuery("tags != spam").groups[0].conditions[0]).toEqual({
      field: "tag",
      operator: "hasNone",
      values: ["spam"],
    });
  });

  it("parses ~ as contains and !~ as notContains", () => {
    expect(parseFilterQuery("title ~ beach").groups[0].conditions[0].operator).toBe("contains");
    expect(parseFilterQuery("title !~ draft").groups[0].conditions[0].operator).toBe("notContains");
  });

  it("parses date comparisons", () => {
    expect(parseFilterQuery("date >= 2026-01-01").groups[0].conditions[0]).toEqual({
      field: "date",
      operator: "after",
      value: "2026-01-01",
    });
    expect(parseFilterQuery("date <= 2026-06-30").groups[0].conditions[0].operator).toBe("before");
  });

  it("parses booleans from yes/no/true/false/1/0", () => {
    for (const truthy of ["yes", "true", "1", "YES"]) {
      expect(parseFilterQuery(`pinned = ${truthy}`).groups[0].conditions[0].value).toBe("true");
    }
    for (const falsy of ["no", "false", "0"]) {
      expect(parseFilterQuery(`pinned = ${falsy}`).groups[0].conditions[0].value).toBe("false");
    }
  });

  it("reads `!= yes` as `= no`", () => {
    expect(parseFilterQuery("locked != yes").groups[0].conditions[0]).toEqual({
      field: "isLocked",
      operator: "is",
      value: "false",
    });
  });

  it("parses `is empty` and `is not empty`", () => {
    expect(parseFilterQuery("place is empty").groups[0].conditions[0]).toEqual({
      field: "placeName",
      operator: "isEmpty",
    });
    expect(parseFilterQuery("title is not empty").groups[0].conditions[0].operator).toBe("isNotEmpty");
  });

  it("accepts field aliases", () => {
    expect(parseFilterQuery("tags = x").groups[0].conditions[0].field).toBe("tag");
    expect(parseFilterQuery("categories = x").groups[0].conditions[0].field).toBe("category");
    expect(parseFilterQuery("place ~ Rome").groups[0].conditions[0].field).toBe("placeName");
    expect(parseFilterQuery("pinned = yes").groups[0].conditions[0].field).toBe("isPinned");
  });

  it("is case-insensitive on field names and keywords", () => {
    const filter = parseFilterQuery("CATEGORY = TRIP AND Title ~ beach");
    expect(filter.groups[0].conditions).toHaveLength(2);
    // The *value* keeps its case — TRIP is data, not syntax.
    expect(filter.groups[0].conditions[0].values).toEqual(["TRIP"]);
    expect(filter.groups[0].conditions[1].value).toBe("beach");
  });
});

describe("parseFilterQuery — joins and groups", () => {
  it("joins with and into ONE group, not two single-condition groups", () => {
    // Parens are what create groups; a bare `and` is an intra-group join. The
    // tree shape matters because it's what the builder renders for editing.
    const filter = parseFilterQuery("category = TRIP and title ~ beach");
    expect(filter.groups).toHaveLength(1);
    expect(filter.groups[0].join).toBe("AND");
    expect(filter.groups[0].conditions).toHaveLength(2);
  });

  it("joins with or", () => {
    const filter = parseFilterQuery("title ~ rome or title ~ oslo");
    expect(filter.groups).toHaveLength(1);
    expect(filter.groups[0].join).toBe("OR");
    expect(filter.groups[0].conditions).toHaveLength(2);
  });

  it("parses (A or B) and C into two groups", () => {
    const filter = parseFilterQuery("(title ~ rome or title ~ oslo) and category = TRIP");
    expect(filter.join).toBe("AND");
    expect(filter.groups).toHaveLength(2);
    expect(filter.groups[0].join).toBe("OR");
    expect(filter.groups[0].conditions).toHaveLength(2);
    expect(filter.groups[1].conditions[0].field).toBe("category");
  });

  it("does not split on `and` inside a word", () => {
    // "android" contains "and" — a naive split would break this.
    const filter = parseFilterQuery("title ~ android");
    expect(filter.groups[0].conditions).toHaveLength(1);
    expect(filter.groups[0].conditions[0].value).toBe("android");
  });

  it("does not split on `or` inside a value", () => {
    const filter = parseFilterQuery("title ~ oregon");
    expect(filter.groups[0].conditions).toHaveLength(1);
    expect(filter.groups[0].conditions[0].value).toBe("oregon");
  });
});

describe("parseFilterQuery — errors", () => {
  it("rejects an unknown field and names the known ones", () => {
    expect(() => parseFilterQuery("catgory = TRIP")).toThrow(FilterQueryError);
    expect(() => parseFilterQuery("catgory = TRIP")).toThrow(/Unknown field "catgory"/);
    // The suggestions must be spellings that actually parse — pointing someone at
    // "placeName"/"isPinned" would send them to write the thing that fails.
    expect(() => parseFilterQuery("catgory = TRIP")).toThrow(/place, category, tags, pinned/);
    expect(() => parseFilterQuery("catgory = TRIP")).not.toThrow(/placeName|isPinned/);
  });

  it("quotes the user's own spelling back in errors, not the canonical name", () => {
    expect(() => parseFilterQuery("pinned = maybe")).toThrow(/"pinned" takes yes or no/);
    expect(() => parseFilterQuery("place =")).toThrow(/"place" needs a value/);
  });

  it("rejects an empty query", () => {
    expect(() => parseFilterQuery("")).toThrow(/empty/i);
    expect(() => parseFilterQuery("   ")).toThrow(/empty/i);
  });

  it("rejects unbalanced parentheses", () => {
    expect(() => parseFilterQuery("(title ~ a")).toThrow(/Unbalanced \(/);
    expect(() => parseFilterQuery("title ~ a)")).toThrow(/Unbalanced \)/);
  });

  it("rejects nested groups rather than half-supporting them", () => {
    expect(() => parseFilterQuery("((a ~ b))")).toThrow(/nested/i);
  });

  it("rejects mixing and/or at one level as ambiguous", () => {
    // No invented precedence — the caller is told to use parentheses.
    expect(() => parseFilterQuery("title ~ a and title ~ b or title ~ c")).toThrow(/ambiguous/i);
  });

  it("rejects a comparison the field doesn't support", () => {
    // A taxonomy can't be range-compared.
    expect(() => parseFilterQuery("category >= TRIP")).toThrow(/supports/i);
  });

  it("rejects a non-boolean value for a boolean field", () => {
    expect(() => parseFilterQuery("pinned = maybe")).toThrow(/yes or no/i);
  });

  it("rejects a missing value", () => {
    expect(() => parseFilterQuery("title ~")).toThrow(/needs a value/i);
  });

  it("rejects a clause with no comparator", () => {
    expect(() => parseFilterQuery("just some words")).toThrow(/Couldn't read/);
  });

  it("tryParseFilterQuery reports instead of throwing", () => {
    const bad = tryParseFilterQuery("catgory = TRIP");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/Unknown field/);

    const good = tryParseFilterQuery("category = TRIP");
    expect(good.ok).toBe(true);
  });
});

describe("parseFilterQuery — feeds the same engine as the builder", () => {
  it("compiles to runnable SQL with parameters", () => {
    const filter = parseFilterQuery("(title ~ rome or title ~ oslo) and category = TRIP");
    const compiled = buildFilterSql(filter)!;
    expect(compiled.sql).toContain("EXISTS");
    expect(compiled.sql).toContain("OR");
    expect(compiled.sql).not.toContain("?");
    expect(Object.keys(compiled.params)).toHaveLength(3);
  });

  it("describes readably, so a query and a built filter read the same", () => {
    // Parenthesized because it's one multi-condition group — the same text
    // describeFilter produces for the equivalent builder-made filter.
    expect(describeFilter(parseFilterQuery("category = TRIP and title ~ beach"))).toBe(
      '(Category is any of TRIP AND Title contains "beach")',
    );
    // A single condition needs no parens.
    expect(describeFilter(parseFilterQuery("category = TRIP"))).toBe("Category is any of TRIP");
  });

  it("a value that looks like SQL stays a parameter", () => {
    const filter = parseFilterQuery("title ~ '; DROP TABLE jrn_entries; --");
    const compiled = buildFilterSql(filter)!;
    expect(compiled.sql).not.toContain("DROP TABLE");
    expect(Object.values(compiled.params).join()).toContain("DROP TABLE");
  });
});
