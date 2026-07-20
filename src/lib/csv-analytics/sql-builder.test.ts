import { describe, expect, it } from "vitest";
import type { CsvColumnDefinition } from "./types";
import {
  buildCreateTableSql,
  buildDropTableSql,
  buildInsertSql,
  buildTableName,
  coerceCellValue,
  dedupeColumnNames,
  inferColumnType,
  quoteIdentifier,
  slugifyIdentifier,
} from "./sql-builder";

describe("slugifyIdentifier", () => {
  it("lowercases and replaces non-alphanumeric runs with underscores", () => {
    expect(slugifyIdentifier("User ID")).toBe("user_id");
    expect(slugifyIdentifier("Date/Time!!")).toBe("date_time");
  });

  it("trims leading/trailing underscores left over from stripped characters", () => {
    expect(slugifyIdentifier("--Total--")).toBe("total");
  });

  it("falls back when the result would be empty", () => {
    expect(slugifyIdentifier("###", "fallback")).toBe("fallback");
    expect(slugifyIdentifier("")).toBe("col");
  });

  it("prefixes with c_ when the slug would start with a digit", () => {
    expect(slugifyIdentifier("2024_total")).toBe("c_2024_total");
  });

  it("caps length at 40 characters", () => {
    const long = "a".repeat(60);
    expect(slugifyIdentifier(long).length).toBe(40);
  });

  it("rejects SQL-meaningful characters entirely — no quotes or semicolons survive", () => {
    expect(slugifyIdentifier(`col"; DROP TABLE users; --`)).toBe("col_drop_table_users");
  });
});

describe("dedupeColumnNames", () => {
  it("returns unique slugs unchanged", () => {
    expect(dedupeColumnNames(["User ID", "Amount"])).toEqual(["user_id", "amount"]);
  });

  it("suffixes repeats with _2, _3, ...", () => {
    expect(dedupeColumnNames(["Date", "date", "DATE"])).toEqual(["date", "date_2", "date_3"]);
  });
});

describe("buildTableName", () => {
  it("always prefixes csv_", () => {
    expect(buildTableName("sales_2024")).toBe("csv_sales_2024");
  });

  it("slugifies the base name too", () => {
    expect(buildTableName("Sales 2024!")).toBe("csv_sales_2024");
  });
});

describe("quoteIdentifier", () => {
  it("wraps in double quotes", () => {
    expect(quoteIdentifier("user_id")).toBe('"user_id"');
  });

  it("doubles any embedded quote as defense in depth", () => {
    expect(quoteIdentifier('weird"name')).toBe('"weird""name"');
  });
});

describe("buildCreateTableSql", () => {
  const columns: CsvColumnDefinition[] = [
    { name: "user_id", sourceHeader: "User ID", type: "integer" },
    { name: "event_at", sourceHeader: "Event At", type: "datetime" },
  ];

  it("uses a composite primary key on the chosen fields when provided", () => {
    const sql = buildCreateTableSql("csv_events", columns, ["user_id", "event_at"]);
    expect(sql).toContain('CREATE TABLE "csv_events"');
    expect(sql).toContain('"user_id" INTEGER');
    expect(sql).toContain('"event_at" TEXT');
    expect(sql).toContain('PRIMARY KEY ("user_id", "event_at")');
    expect(sql).not.toContain("_row_id");
  });

  it("adds a surrogate autoincrement key when no primary key fields are chosen", () => {
    const sql = buildCreateTableSql("csv_events", columns, []);
    expect(sql).toContain('"_row_id" INTEGER PRIMARY KEY AUTOINCREMENT');
    expect(sql).not.toContain("PRIMARY KEY (");
  });
});

describe("buildDropTableSql / buildInsertSql", () => {
  it("builds a guarded drop statement", () => {
    expect(buildDropTableSql("csv_events")).toBe('DROP TABLE IF EXISTS "csv_events"');
  });

  it("builds a named-parameter insert matching each column name", () => {
    const columns: CsvColumnDefinition[] = [
      { name: "user_id", sourceHeader: "User ID", type: "integer" },
      { name: "amount", sourceHeader: "Amount", type: "real" },
    ];
    expect(buildInsertSql("csv_events", columns, false)).toBe(
      'INSERT INTO "csv_events" ("user_id", "amount") VALUES (@user_id, @amount)',
    );
    expect(buildInsertSql("csv_events", columns, true)).toBe(
      'INSERT OR IGNORE INTO "csv_events" ("user_id", "amount") VALUES (@user_id, @amount)',
    );
  });
});

describe("coerceCellValue", () => {
  it("returns null for empty/whitespace/undefined input regardless of type", () => {
    expect(coerceCellValue("", "text")).toBeNull();
    expect(coerceCellValue("   ", "integer")).toBeNull();
    expect(coerceCellValue(undefined, "real")).toBeNull();
  });

  it("text always returns the trimmed string", () => {
    expect(coerceCellValue("  hello  ", "text")).toBe("hello");
  });

  it("integer parses whole numbers, rejects non-integers", () => {
    expect(coerceCellValue("42", "integer")).toBe(42);
    expect(coerceCellValue("42.5", "integer")).toBeNull();
    expect(coerceCellValue("abc", "integer")).toBeNull();
  });

  it("real parses any finite number", () => {
    expect(coerceCellValue("42.5", "real")).toBe(42.5);
    expect(coerceCellValue("abc", "real")).toBeNull();
  });

  it("boolean recognizes common spellings", () => {
    expect(coerceCellValue("true", "boolean")).toBe(1);
    expect(coerceCellValue("No", "boolean")).toBe(0);
    expect(coerceCellValue("maybe", "boolean")).toBeNull();
  });

  it("date returns a YYYY-MM-DD string, null when unparseable", () => {
    expect(coerceCellValue("2026-03-15", "date")).toBe("2026-03-15");
    expect(coerceCellValue("not a date", "date")).toBeNull();
  });

  it("datetime returns a full ISO string, null when unparseable", () => {
    expect(coerceCellValue("2026-03-15T10:30:00Z", "datetime")).toBe("2026-03-15T10:30:00.000Z");
    expect(coerceCellValue("not a date", "datetime")).toBeNull();
  });
});

describe("inferColumnType", () => {
  it("suggests integer for whole-number samples", () => {
    expect(inferColumnType(["1", "2", "300"])).toBe("integer");
  });

  it("suggests real when samples include decimals", () => {
    expect(inferColumnType(["1.5", "2", "3.25"])).toBe("real");
  });

  it("suggests boolean for true/false-like samples that aren't numeric", () => {
    expect(inferColumnType(["true", "false", "true"])).toBe("boolean");
  });

  it("suggests date for YYYY-MM-DD samples", () => {
    expect(inferColumnType(["2026-01-01", "2026-03-15"])).toBe("date");
  });

  it("suggests datetime for timestamp samples", () => {
    expect(inferColumnType(["2026-01-01T10:00:00Z", "2026-03-15T09:30:00Z"])).toBe("datetime");
  });

  it("falls back to text for mixed or free-form samples", () => {
    expect(inferColumnType(["Apple Inc.", "42", "N/A"])).toBe("text");
  });

  it("falls back to text when every sample is blank", () => {
    expect(inferColumnType(["", "  "])).toBe("text");
  });
});
