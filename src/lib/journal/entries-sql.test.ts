import { describe, expect, it } from "vitest";
import { buildEntriesSql, describeEntriesSql, inlineSqlParams } from "./entries-sql";
import { SUBSTANTIAL_MIN_WORDS } from "./body-length";
import type { JournalFilter } from "./types";

const EMPTY: JournalFilter = { join: "AND", groups: [] };

function withCategory(name: string): JournalFilter {
  return {
    join: "AND",
    groups: [{ join: "AND", conditions: [{ field: "category", operator: "hasAny", values: [name] }] }],
  };
}

describe("buildEntriesSql", () => {
  it("omits WHERE entirely when nothing narrows", () => {
    const { sql, params } = buildEntriesSql(EMPTY, 500);
    expect(sql).not.toContain("WHERE");
    expect(sql).toContain("FROM jrn_entries e");
    expect(sql).toContain("ORDER BY e.entry_date DESC, e.entry_time DESC, e.id DESC");
    expect(sql).toContain("LIMIT @__limit");
    expect(params.__limit).toBe(500);
  });

  it("wraps the filter's conditions in their own parentheses", () => {
    const { sql } = buildEntriesSql(withCategory("TRIP"), 500);
    expect(sql).toContain("WHERE (");
    // The filter's parameters ride along for binding.
    expect(Object.keys(buildEntriesSql(withCategory("TRIP"), 500).params).length).toBeGreaterThan(1);
  });

  it("adds the body-length term only for the substantial scope", () => {
    const plain = buildEntriesSql(EMPTY, 500, "all");
    expect(plain.sql).not.toContain("length(trim(e.content))");

    const substantial = buildEntriesSql(EMPTY, 500, "substantial");
    expect(substantial.sql).toContain("WHERE (length(trim(e.content)) > 0");
    expect(substantial.sql).toContain("e.is_encrypted = 0");
    expect(substantial.params.__minSpaces).toBe(SUBSTANTIAL_MIN_WORDS);
  });

  it("ANDs the body-length term onto the filter rather than merging it", () => {
    const { sql } = buildEntriesSql(withCategory("TRIP"), 500, "substantial");
    expect(sql).toContain(") AND (length(trim(e.content))");
  });

  it("keeps an OR-joined filter parenthesised so the body term can't bind to one branch", () => {
    const orFilter: JournalFilter = {
      join: "OR",
      groups: [
        { join: "AND", conditions: [{ field: "category", operator: "hasAny", values: ["A"] }] },
        { join: "AND", conditions: [{ field: "category", operator: "hasAny", values: ["B"] }] },
      ],
    };
    const { sql } = buildEntriesSql(orFilter, 500, "substantial");
    const where = sql.slice(sql.indexOf("WHERE"));
    // The whole OR expression sits inside one pair of parens, ahead of the AND.
    expect(where.startsWith("WHERE ((")).toBe(true);
    expect(where).toContain(" OR ");
    expect(where).toContain(") AND (length(trim(e.content))");
  });

  it("honours an explicit sort", () => {
    const sorted: JournalFilter = { ...EMPTY, sort: [{ field: "title", direction: "asc" }] };
    expect(buildEntriesSql(sorted, 500).sql).toContain("ORDER BY e.title ASC, e.id DESC");
  });
});

describe("inlineSqlParams", () => {
  it("writes numbers bare and strings quoted", () => {
    expect(inlineSqlParams("LIMIT @__limit", { __limit: 500 })).toBe("LIMIT 500");
    expect(inlineSqlParams("= @p0", { p0: "TRIP" })).toBe("= 'TRIP'");
  });

  it("doubles an embedded quote so the display stays valid SQL", () => {
    expect(inlineSqlParams("= @p0", { p0: "Apo's outburst" })).toBe("= 'Apo''s outburst'");
  });

  it("substitutes the longest name first so a shared prefix is not partly eaten", () => {
    // @p1 is a prefix of @p10; replacing it first would leave a stray "0".
    expect(inlineSqlParams("@p1 @p10", { p1: "a", p10: "b" })).toBe("'a' 'b'");
  });

  it("leaves a name that is not a parameter untouched", () => {
    expect(inlineSqlParams("@other", { p0: "x" })).toBe("@other");
  });
});

describe("describeEntriesSql", () => {
  it("returns a statement with no parameter placeholders left", () => {
    const sql = describeEntriesSql(withCategory("Apo's outburst"), 500, "substantial");
    expect(sql).not.toContain("@");
    expect(sql).toContain("'Apo''s outburst'");
    expect(sql).toContain("LIMIT 500");
  });
});
