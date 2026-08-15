import { describe, expect, it } from "vitest";
import {
  buildFilterSql,
  describeCondition,
  describeFilter,
  emptyFilter,
  isFilterEmpty,
} from "./filters";
import { parseStoredJournalFilter } from "./schema";
import type { JournalFilter, JournalFilterCondition } from "./types";

/** One condition wrapped in the minimum filter that holds it. */
function oneCondition(condition: JournalFilterCondition): JournalFilter {
  return { join: "AND", groups: [{ join: "AND", conditions: [condition] }] };
}

describe("buildFilterSql — safety", () => {
  it("never interpolates a value into the SQL text", () => {
    const compiled = buildFilterSql(
      oneCondition({ field: "title", operator: "contains", value: "'; DROP TABLE jrn_entries; --" }),
    );
    expect(compiled).toBeDefined();
    expect(compiled!.sql).not.toContain("DROP TABLE");
    // The value reached a parameter instead.
    expect(Object.values(compiled!.params).join()).toContain("DROP TABLE");
  });

  it("emits only named parameters", () => {
    const compiled = buildFilterSql(
      oneCondition({ field: "title", operator: "contains", value: "trip" }),
    );
    expect(compiled!.sql).toMatch(/@[A-Za-z0-9_]+/);
    expect(compiled!.sql).not.toContain("?");
  });

  it("drops an unknown field rather than putting it in the query", () => {
    // Simulates a hand-edited DB row: the type is a lie, which is the whole point.
    const rogue = { field: "id; DROP TABLE x", operator: "equals", value: "1" } as unknown as JournalFilterCondition;
    expect(buildFilterSql(oneCondition(rogue))).toBeUndefined();
  });

  it("drops an operator the field doesn't allow", () => {
    // `hasAny` is a taxonomy operator; on a text column it must not compile.
    const mismatched = { field: "title", operator: "hasAny", values: ["x"] } as JournalFilterCondition;
    expect(buildFilterSql(oneCondition(mismatched))).toBeUndefined();
  });

  it("escapes LIKE wildcards so they match literally", () => {
    const compiled = buildFilterSql(
      oneCondition({ field: "title", operator: "contains", value: "100%_done" }),
    );
    expect(Object.values(compiled!.params)[0]).toBe("%100\\%\\_done%");
    expect(compiled!.sql).toContain("ESCAPE");
  });
});

describe("buildFilterSql — incomplete conditions", () => {
  it("returns undefined for an empty filter", () => {
    expect(buildFilterSql(emptyFilter())).toBeUndefined();
    expect(isFilterEmpty(emptyFilter())).toBe(true);
  });

  it("drops a condition whose value is still blank", () => {
    // Half-typed in the builder — must not narrow the result to nothing.
    expect(buildFilterSql(oneCondition({ field: "title", operator: "contains", value: "" }))).toBeUndefined();
  });

  it("drops a taxonomy condition with no names chosen", () => {
    expect(buildFilterSql(oneCondition({ field: "tag", operator: "hasAny", values: [] }))).toBeUndefined();
    expect(
      buildFilterSql(oneCondition({ field: "tag", operator: "hasAny", values: ["  "] })),
    ).toBeUndefined();
  });

  it("keeps the complete conditions and drops only the incomplete one", () => {
    const filter: JournalFilter = {
      join: "AND",
      groups: [
        {
          join: "AND",
          conditions: [
            { field: "title", operator: "contains", value: "trip" },
            { field: "content", operator: "contains", value: "" },
          ],
        },
      ],
    };
    const compiled = buildFilterSql(filter)!;
    expect(compiled.sql).toContain("e.title");
    expect(compiled.sql).not.toContain("e.content");
    // One surviving condition needs no parens.
    expect(compiled.sql).not.toContain("(");
  });
});

describe("buildFilterSql — operators", () => {
  it("compiles a between with both bounds", () => {
    const compiled = buildFilterSql(
      oneCondition({ field: "date", operator: "between", value: "2026-01-01", valueTo: "2026-06-30" }),
    )!;
    expect(compiled.sql).toBe("(e.entry_date >= @g0c0_from AND e.entry_date <= @g0c0_to)");
    expect(compiled.params).toEqual({ g0c0_from: "2026-01-01", g0c0_to: "2026-06-30" });
  });

  it("narrows in one direction when a between has only one bound", () => {
    const fromOnly = buildFilterSql(
      oneCondition({ field: "date", operator: "between", value: "2026-01-01", valueTo: "" }),
    )!;
    expect(fromOnly.sql).toBe("e.entry_date >= @g0c0_from");

    const toOnly = buildFilterSql(
      oneCondition({ field: "date", operator: "between", value: "", valueTo: "2026-06-30" }),
    )!;
    expect(toOnly.sql).toBe("e.entry_date <= @g0c0_to");
  });

  it("compiles hasAny as EXISTS and hasNone as NOT EXISTS", () => {
    const any = buildFilterSql(
      oneCondition({ field: "category", operator: "hasAny", values: ["Travel", "Work"] }),
    )!;
    expect(any.sql).toContain("EXISTS");
    expect(any.sql).not.toContain("NOT EXISTS");
    expect(any.sql).toContain("jrn_entry_categories");
    expect(any.params).toEqual({ g0c0_0: "Travel", g0c0_1: "Work" });

    const none = buildFilterSql(
      oneCondition({ field: "tag", operator: "hasNone", values: ["spam"] }),
    )!;
    expect(none.sql).toContain("NOT EXISTS");
    expect(none.sql).toContain("jrn_entry_tags");
  });

  it("compiles booleans to 0/1", () => {
    const yes = buildFilterSql(oneCondition({ field: "isPinned", operator: "is", value: "true" }))!;
    expect(yes.params).toEqual({ g0c0: 1 });
    const no = buildFilterSql(oneCondition({ field: "isLocked", operator: "is", value: "false" }))!;
    expect(no.params).toEqual({ g0c0: 0 });
  });

  it("compiles isEmpty / isNotEmpty without a parameter", () => {
    const empty = buildFilterSql(oneCondition({ field: "placeName", operator: "isEmpty" }))!;
    expect(empty.params).toEqual({});
    expect(empty.sql).toContain("IS NULL OR");

    const notEmpty = buildFilterSql(oneCondition({ field: "placeName", operator: "isNotEmpty" }))!;
    expect(notEmpty.sql).toContain("IS NOT NULL AND");
  });

  it("compiles notContains to NOT LIKE", () => {
    const compiled = buildFilterSql(
      oneCondition({ field: "content", operator: "notContains", value: "draft" }),
    )!;
    expect(compiled.sql).toContain("NOT LIKE");
  });
});

describe("buildFilterSql — group joins", () => {
  const a: JournalFilterCondition = { field: "title", operator: "contains", value: "a" };
  const b: JournalFilterCondition = { field: "content", operator: "contains", value: "b" };
  const c: JournalFilterCondition = { field: "placeName", operator: "contains", value: "c" };

  it("joins conditions inside a group with the group's join, parenthesized", () => {
    const compiled = buildFilterSql({ join: "AND", groups: [{ join: "OR", conditions: [a, b] }] })!;
    expect(compiled.sql).toBe("(e.title LIKE @g0c0 ESCAPE '\\' OR e.content LIKE @g0c1 ESCAPE '\\')");
  });

  it("joins groups with the filter's own join — (A or B) and C", () => {
    const compiled = buildFilterSql({
      join: "AND",
      groups: [
        { join: "OR", conditions: [a, b] },
        { join: "AND", conditions: [c] },
      ],
    })!;
    expect(compiled.sql).toBe(
      "(e.title LIKE @g0c0 ESCAPE '\\' OR e.content LIKE @g0c1 ESCAPE '\\') AND e.place_name LIKE @g1c0 ESCAPE '\\'",
    );
  });

  it("gives every condition a distinct parameter name across groups", () => {
    const compiled = buildFilterSql({
      join: "OR",
      groups: [
        { join: "AND", conditions: [a, b] },
        { join: "AND", conditions: [a, b] },
      ],
    })!;
    // Four conditions, four params — a collision would silently drop one.
    expect(Object.keys(compiled.params)).toHaveLength(4);
  });

  it("skips a group in which nothing compiles", () => {
    const compiled = buildFilterSql({
      join: "AND",
      groups: [
        { join: "AND", conditions: [a] },
        { join: "AND", conditions: [{ field: "title", operator: "contains", value: "" }] },
      ],
    })!;
    expect(compiled.sql).toBe("e.title LIKE @g0c0 ESCAPE '\\'");
  });
});

describe("describeFilter", () => {
  it("reads back a single condition", () => {
    expect(describeFilter(oneCondition({ field: "title", operator: "contains", value: "trip" }))).toBe(
      'Title contains "trip"',
    );
  });

  it("parenthesizes a multi-condition group and joins groups", () => {
    const text = describeFilter({
      join: "AND",
      groups: [
        {
          join: "OR",
          conditions: [
            { field: "title", operator: "contains", value: "trip" },
            { field: "placeName", operator: "contains", value: "Rome" },
          ],
        },
        { join: "AND", conditions: [{ field: "category", operator: "hasAny", values: ["Travel"] }] },
      ],
    });
    expect(text).toBe('(Title contains "trip" OR Place contains "Rome") AND Category is any of Travel');
  });

  it("says so when a filter has no conditions", () => {
    expect(describeFilter(emptyFilter())).toBe("No conditions — matches every entry.");
  });

  it("shows an incomplete condition rather than hiding it", () => {
    // A saved filter's description must account for every row the builder shows.
    expect(describeCondition({ field: "title", operator: "contains", value: "" })).toBe("Title contains …");
  });

  it("renders booleans as yes/no and ranges readably", () => {
    expect(describeCondition({ field: "isPinned", operator: "is", value: "true" })).toBe("Pinned is yes");
    expect(
      describeCondition({ field: "date", operator: "between", value: "2026-01-01", valueTo: "2026-06-30" }),
    ).toBe("Date is between 2026-01-01 and 2026-06-30");
    // A one-sided range reads as the comparison it actually is.
    expect(describeCondition({ field: "date", operator: "between", value: "2026-01-01" })).toBe(
      "Date is after 2026-01-01",
    );
  });
});

describe("parseStoredJournalFilter", () => {
  it("round-trips a filter written by saveFilter", () => {
    const filter = oneCondition({ field: "tag", operator: "hasAny", values: ["daily"] });
    expect(parseStoredJournalFilter(JSON.stringify(filter))).toEqual(filter);
  });

  it("returns an empty filter for unreadable JSON rather than throwing", () => {
    // A screen that still works beats a 500 on a hand-mangled row.
    expect(parseStoredJournalFilter("{not json")).toEqual({ join: "AND", groups: [] });
    expect(parseStoredJournalFilter("null")).toEqual({ join: "AND", groups: [] });
  });

  it("widens a bare condition array into a single AND group", () => {
    // The shape a first cut might have written before groups existed.
    const legacy = JSON.stringify([{ field: "title", operator: "contains", value: "trip" }]);
    expect(parseStoredJournalFilter(legacy)).toEqual({
      join: "AND",
      groups: [{ join: "AND", conditions: [{ field: "title", operator: "contains", value: "trip" }] }],
    });
  });

  it("keeps the valid conditions when some are unrecognizable", () => {
    const mixed = JSON.stringify({
      join: "OR",
      groups: [
        {
          join: "AND",
          conditions: [
            { field: "title", operator: "contains", value: "keep" },
            { field: "nonsense", operator: "contains", value: "drop" },
          ],
        },
      ],
    });
    const parsed = parseStoredJournalFilter(mixed);
    expect(parsed.join).toBe("OR");
    expect(parsed.groups[0].conditions).toHaveLength(1);
    expect(parsed.groups[0].conditions[0].value).toBe("keep");
  });
});
