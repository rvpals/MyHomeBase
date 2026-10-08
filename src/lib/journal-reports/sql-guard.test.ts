import { describe, expect, it } from "vitest";
import { ReportSqlError, assertReadOnlyFragment, checkReadOnlyFragment } from "./sql-guard";

describe("assertReadOnlyFragment", () => {
  it("accepts a plain boolean condition", () => {
    expect(() => assertReadOnlyFragment("e.entry_date >= '2026-01-01'")).not.toThrow();
  });

  it("accepts an empty fragment as 'every entry'", () => {
    expect(() => assertReadOnlyFragment("")).not.toThrow();
    expect(() => assertReadOnlyFragment("   ")).not.toThrow();
  });

  it("accepts a subquery — the reason raw SQL mode exists", () => {
    expect(() =>
      assertReadOnlyFragment(
        "e.id IN (SELECT entry_id FROM jrn_entry_tags GROUP BY entry_id HAVING COUNT(*) > 3)",
      ),
    ).not.toThrow();
  });

  it("rejects a semicolon, so a second statement can't ride along", () => {
    expect(() => assertReadOnlyFragment("1=1; DROP TABLE jrn_entries")).toThrow(ReportSqlError);
  });

  it("rejects a line comment, which would comment out the rest of the query", () => {
    // Without this the appended `AND e.is_encrypted = 0` and the ORDER BY would
    // both be swallowed.
    expect(() => assertReadOnlyFragment("1=1 --")).toThrow(/comment/i);
  });

  it("rejects a block comment", () => {
    expect(() => assertReadOnlyFragment("1=1 /* hide the rest */")).toThrow(/comment/i);
  });

  it.each([
    ["DELETE FROM jrn_entries", /DELETE/],
    ["INSERT INTO jrn_entries VALUES (1)", /INSERT/],
    ["UPDATE jrn_entries SET title = 'x'", /UPDATE/],
    ["DROP TABLE jrn_entries", /DROP/],
    ["ATTACH DATABASE 'other.db' AS other", /ATTACH/],
    ["PRAGMA journal_mode = DELETE", /PRAGMA|DELETE/],
    ["CREATE TRIGGER t AFTER INSERT ON jrn_entries BEGIN SELECT 1; END", /CREATE|INSERT|BEGIN/],
  ])("rejects %s", (fragment, message) => {
    expect(() => assertReadOnlyFragment(fragment)).toThrow(message);
  });

  it("rejects load_extension and the filesystem functions", () => {
    expect(() => assertReadOnlyFragment("load_extension('evil.so')")).toThrow(/load_extension/);
    expect(() => assertReadOnlyFragment("readfile('/etc/passwd') IS NOT NULL")).toThrow(/readfile/);
    expect(() => assertReadOnlyFragment("writefile('x', 'y') > 0")).toThrow(/writefile/);
  });

  it("does not reject a forbidden word that only appears inside a string literal", () => {
    // The point of blanking literals: searching entries about a software update
    // is legitimate and must not trip the DML check.
    expect(() => assertReadOnlyFragment("e.title LIKE '%update%'")).not.toThrow();
    expect(() => assertReadOnlyFragment("e.content LIKE '%drop the kids off%'")).not.toThrow();
  });

  it("handles SQLite's doubled-quote escape inside a literal", () => {
    expect(() => assertReadOnlyFragment("e.title = 'it''s a delete'")).not.toThrow();
  });

  it("rejects a forbidden word that merely looks quoted", () => {
    // The literal closes before DROP, so DROP really is live SQL here.
    expect(() => assertReadOnlyFragment("e.title = 'x' AND DROP")).toThrow(/DROP/);
  });

  it("does not reject a column whose name contains a forbidden word as a substring", () => {
    // `updated_at` contains "update" but is not the UPDATE keyword — the word
    // boundary is what makes this work.
    expect(() => assertReadOnlyFragment("e.updated_at > '2026-01-01'")).not.toThrow();
    expect(() => assertReadOnlyFragment("e.created_at IS NOT NULL")).not.toThrow();
  });

  it("rejects unbalanced parentheses, which would be a syntax error at render", () => {
    expect(() => assertReadOnlyFragment("(e.title = 'x'")).toThrow(/parenthes/i);
    expect(() => assertReadOnlyFragment("e.title = 'x')")).toThrow(/parenthes/i);
  });

  it("rejects an unterminated literal, which would swallow the rest of the query", () => {
    expect(() => assertReadOnlyFragment("e.title = 'unclosed")).toThrow(/unterminated/i);
  });

  it("rejects a fragment longer than the cap", () => {
    expect(() => assertReadOnlyFragment(`e.id > 0 AND ${"e.id > 0 AND ".repeat(300)}e.id > 0`))
      .toThrow(/too long/i);
  });
});

describe("checkReadOnlyFragment", () => {
  it("reports ok for a valid fragment", () => {
    expect(checkReadOnlyFragment("e.id > 0")).toEqual({ ok: true });
  });

  it("returns the message instead of throwing, for the editor to render", () => {
    const result = checkReadOnlyFragment("DROP TABLE jrn_entries");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/DROP/);
  });
});
