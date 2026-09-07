import { describe, expect, it } from "vitest";
import { fakeColumn } from "./fake-repository";
import type { CsvViewCriterion } from "./types";
import {
  compileViewQuery,
  describeCriteria,
  describeOrderBy,
  findIncompleteCriteria,
  findUnknownColumns,
  operatorArity,
  resolveSelectedColumns,
} from "./view-query";

const COLUMNS = [
  fakeColumn("city"),
  fakeColumn("amount", "real"),
  fakeColumn("qty", "integer"),
  fakeColumn("seen_on", "date"),
];

function compile(
  criteria: CsvViewCriterion[],
  overrides: Partial<Parameters<typeof compileViewQuery>[0]> = {},
) {
  return compileViewQuery({
    tableName: "csv_sales",
    entryColumns: COLUMNS,
    selectedColumns: [],
    criteria,
    orderBy: [],
    recordsPerPage: 25,
    page: 1,
    ...overrides,
  });
}

function criterion(
  column: string,
  operator: CsvViewCriterion["operator"],
  ...values: string[]
): CsvViewCriterion {
  return { column, operator, values };
}

describe("compileViewQuery — shape", () => {
  it("selects every column, quoted, when nothing is selected", () => {
    const { sql, params } = compile([]);
    expect(sql).toBe(
      'SELECT "city", "amount", "qty", "seen_on" FROM "csv_sales" LIMIT 25 OFFSET 0',
    );
    expect(params).toEqual([]);
  });

  it("selects only the named columns, in the order they were named", () => {
    const { sql, columns } = compile([], { selectedColumns: ["qty", "city"] });
    expect(sql).toContain('SELECT "qty", "city" FROM');
    expect(columns.map((column) => column.name)).toEqual(["qty", "city"]);
  });

  it("pages with LIMIT and a computed OFFSET", () => {
    expect(compile([], { recordsPerPage: 10, page: 3 }).sql).toContain("LIMIT 10 OFFSET 20");
  });

  it("floors a fractional page size and clamps a page below 1", () => {
    // Neither can arrive through the schema; the guard is what keeps a raw caller
    // (a CLI arg, a hand-built action payload) from reaching the SQL string.
    expect(compile([], { recordsPerPage: 10.9, page: 0 }).sql).toContain("LIMIT 10 OFFSET 0");
  });

  it("emits ORDER BY in list order, honouring each direction", () => {
    const { sql } = compile([], {
      orderBy: [
        { column: "amount", direction: "desc" },
        { column: "city", direction: "asc" },
      ],
    });
    expect(sql).toContain('ORDER BY "amount" DESC, "city" ASC');
  });

  it("builds a COUNT over the same WHERE, with no ORDER BY or LIMIT", () => {
    const { countSql } = compile([criterion("city", "equals", "Rome")]);
    expect(countSql).toBe('SELECT COUNT(*) AS count FROM "csv_sales" WHERE "city" = ?');
  });

  it("ANDs multiple criteria and binds their values in order", () => {
    const { sql, params } = compile([
      criterion("city", "equals", "Rome"),
      criterion("qty", "greaterThan", "5"),
    ]);
    expect(sql).toContain('WHERE "city" = ? AND "qty" > ?');
    expect(params).toEqual(["Rome", 5]);
  });
});

describe("compileViewQuery — operators", () => {
  it.each([
    ["equals", "=", "Rome"],
    ["notEquals", "<>", "Rome"],
    ["greaterThan", ">", "Rome"],
    ["greaterThanOrEqual", ">=", "Rome"],
    ["lessThan", "<", "Rome"],
    ["lessThanOrEqual", "<=", "Rome"],
  ] as const)("compiles %s to %s with one bound value", (operator, sqlOperator, value) => {
    const { sql, params } = compile([criterion("city", operator, value)]);
    expect(sql).toContain(`WHERE "city" ${sqlOperator} ?`);
    expect(params).toEqual([value]);
  });

  it("wraps a contains value in wildcards", () => {
    const { sql, params } = compile([criterion("city", "contains", "om")]);
    expect(sql).toContain(`WHERE "city" LIKE ? ESCAPE '\\'`);
    expect(params).toEqual(["%om%"]);
  });

  it("treats an empty cell as not containing anything", () => {
    // A bare NOT LIKE is NULL for a NULL cell, so every empty row would vanish from
    // a "does not contain" filter. Empty genuinely does not contain the value.
    const { sql } = compile([criterion("city", "notContains", "om")]);
    expect(sql).toContain(`WHERE ("city" IS NULL OR "city" NOT LIKE ? ESCAPE '\\')`);
  });

  it("anchors startsWith and endsWith on the correct side", () => {
    expect(compile([criterion("city", "startsWith", "Ro")]).params).toEqual(["Ro%"]);
    expect(compile([criterion("city", "endsWith", "me")]).params).toEqual(["%me"]);
  });

  it("escapes LIKE wildcards in a user's literal", () => {
    // Without this, searching for "50%" would match "50" followed by anything.
    expect(compile([criterion("city", "contains", "50%_x")]).params).toEqual(["%50\\%\\_x%"]);
  });

  it("compiles between with both bounds", () => {
    const { sql, params } = compile([criterion("amount", "between", "10", "20")]);
    expect(sql).toContain('WHERE "amount" BETWEEN ? AND ?');
    expect(params).toEqual([10, 20]);
  });

  it("treats NULL and the empty string alike for isEmpty", () => {
    const { sql, params } = compile([criterion("city", "isEmpty")]);
    expect(sql).toContain(`WHERE ("city" IS NULL OR "city" = '')`);
    expect(params).toEqual([]);
  });

  it("compiles isNotEmpty as the exact negation of isEmpty", () => {
    expect(compile([criterion("city", "isNotEmpty")]).sql).toContain(
      `WHERE ("city" IS NOT NULL AND "city" <> '')`,
    );
  });

  it("emits one placeholder per value for in", () => {
    const { sql, params } = compile([criterion("city", "in", "Rome", "Oslo", "Lima")]);
    expect(sql).toContain('WHERE "city" IN (?, ?, ?)');
    expect(params).toEqual(["Rome", "Oslo", "Lima"]);
  });

  it("keeps empty cells in a notIn result", () => {
    // Same NULL trap as notContains: an empty cell is not one of the listed values.
    const { sql } = compile([criterion("city", "notIn", "Rome")]);
    expect(sql).toContain(`WHERE ("city" IS NULL OR "city" NOT IN (?))`);
  });
});

describe("compileViewQuery — value coercion", () => {
  it("binds a number for a numeric column so it compares numerically", () => {
    // Bound as text, "9" > "10" in SQLite — the wrong answer for a real column.
    expect(compile([criterion("amount", "greaterThan", "9")]).params).toEqual([9]);
    expect(compile([criterion("qty", "equals", "10")]).params).toEqual([10]);
  });

  it("keeps a text column's value as text even when it looks numeric", () => {
    expect(compile([criterion("city", "equals", "10")]).params).toEqual(["10"]);
  });

  it("normalises a date column's value to ISO", () => {
    expect(compile([criterion("seen_on", "equals", "2026-03-04")]).params).toEqual(["2026-03-04"]);
  });

  it("falls back to the raw text when a value won't coerce", () => {
    // Matches nothing rather than throwing — a half-typed criterion should empty the
    // result, not break the screen.
    expect(compile([criterion("amount", "equals", "abc")]).params).toEqual(["abc"]);
  });

  it("trims surrounding whitespace before binding", () => {
    expect(compile([criterion("city", "equals", "  Rome  ")]).params).toEqual(["Rome"]);
  });
});

describe("compileViewQuery — degrading rather than breaking", () => {
  it("skips a criterion naming a column the entry no longer has", () => {
    const { sql, params } = compile([
      criterion("gone", "equals", "x"),
      criterion("city", "equals", "Rome"),
    ]);
    expect(sql).toContain('WHERE "city" = ?');
    expect(sql).not.toContain("gone");
    expect(params).toEqual(["Rome"]);
  });

  it("skips an order-by naming a column the entry no longer has", () => {
    const { sql } = compile([], { orderBy: [{ column: "gone", direction: "asc" }] });
    expect(sql).not.toContain("ORDER BY");
  });

  it("emits no WHERE at all when every criterion is skipped", () => {
    const { sql } = compile([criterion("gone", "equals", "x")]);
    expect(sql).toBe('SELECT "city", "amount", "qty", "seen_on" FROM "csv_sales" LIMIT 25 OFFSET 0');
  });

  it("skips a criterion whose values don't fill its operator", () => {
    expect(compile([criterion("amount", "between", "10")]).sql).not.toContain("BETWEEN");
    expect(compile([criterion("city", "equals")]).sql).not.toContain("WHERE");
    expect(compile([criterion("city", "in")]).sql).not.toContain("WHERE");
  });
});

describe("resolveSelectedColumns", () => {
  it("returns every column for an empty selection", () => {
    expect(resolveSelectedColumns(COLUMNS, [])).toEqual(COLUMNS);
  });

  it("drops a named column that no longer exists", () => {
    expect(resolveSelectedColumns(COLUMNS, ["city", "gone"]).map((c) => c.name)).toEqual(["city"]);
  });

  it("falls back to every column when nothing named survives", () => {
    // A view showing no columns at all is never the useful reading of a schema change.
    expect(resolveSelectedColumns(COLUMNS, ["gone", "also_gone"])).toEqual(COLUMNS);
  });
});

describe("findUnknownColumns", () => {
  it("finds nothing when every reference resolves", () => {
    expect(
      findUnknownColumns(COLUMNS, {
        selectedColumns: ["city"],
        criteria: [criterion("amount", "greaterThan", "1")],
        orderBy: [{ column: "qty", direction: "asc" }],
      }),
    ).toEqual([]);
  });

  it("reports unknown names from all three lists, deduplicated", () => {
    expect(
      findUnknownColumns(COLUMNS, {
        selectedColumns: ["nope"],
        criteria: [criterion("nope", "equals", "x"), criterion("other", "equals", "y")],
        orderBy: [{ column: "nope", direction: "asc" }],
      }),
    ).toEqual(["nope", "other"]);
  });
});

describe("findIncompleteCriteria", () => {
  it("accepts a no-value operator with no values", () => {
    expect(findIncompleteCriteria([criterion("city", "isEmpty")])).toEqual([]);
  });

  it("rejects a one-value operator with a blank value", () => {
    expect(findIncompleteCriteria([criterion("city", "equals", "   ")])).toHaveLength(1);
  });

  it("rejects between with only one bound", () => {
    expect(findIncompleteCriteria([criterion("amount", "between", "10")])).toHaveLength(1);
    expect(findIncompleteCriteria([criterion("amount", "between", "10", "20")])).toEqual([]);
  });

  it("rejects an empty list for in", () => {
    expect(findIncompleteCriteria([criterion("city", "in")])).toHaveLength(1);
    expect(findIncompleteCriteria([criterion("city", "in", "Rome")])).toEqual([]);
  });
});

describe("operatorArity", () => {
  it("reports the arity the builder UI renders inputs from", () => {
    expect(operatorArity("isEmpty")).toBe("none");
    expect(operatorArity("equals")).toBe("one");
    expect(operatorArity("between")).toBe("two");
    expect(operatorArity("in")).toBe("list");
  });
});

describe("describeCriteria / describeOrderBy", () => {
  it("reads back a criteria list as text", () => {
    expect(
      describeCriteria([
        criterion("amount", "greaterThanOrEqual", "100"),
        criterion("city", "in", "Rome", "Oslo"),
        criterion("qty", "isEmpty"),
      ]),
    ).toBe("amount >= 100 AND city is one of Rome, Oslo AND qty is empty");
  });

  it("spells out a between's two bounds", () => {
    expect(describeCriteria([criterion("amount", "between", "10", "20")])).toBe(
      "amount between 10 and 20",
    );
  });

  it("says so when there is nothing to describe", () => {
    expect(describeCriteria([])).toBe("No criteria");
    expect(describeOrderBy([])).toBe("Unordered");
  });

  it("reads back an order-by list", () => {
    expect(
      describeOrderBy([
        { column: "amount", direction: "desc" },
        { column: "city", direction: "asc" },
      ]),
    ).toBe("amount desc, city asc");
  });
});
