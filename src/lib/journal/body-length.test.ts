import { describe, expect, it } from "vitest";
import {
  SUBSTANTIAL_MIN_WORDS,
  buildBodyLengthSql,
  countBodyWords,
  isSubstantialBody,
} from "./body-length";

/** A body of exactly `count` one-letter words, separated by single spaces. */
function words(count: number): string {
  return Array.from({ length: count }, () => "x").join(" ");
}

describe("buildBodyLengthSql", () => {
  it("contributes nothing for the 'all' scope", () => {
    // Not an empty fragment, and not "1=1" — undefined, so the caller leaves the
    // query exactly as it was for the three tabs that don't narrow by length.
    expect(buildBodyLengthSql("all")).toBeUndefined();
  });

  it("binds the threshold as a parameter rather than interpolating it", () => {
    const compiled = buildBodyLengthSql("substantial");
    expect(compiled).toBeDefined();
    // The allowlist rule from filters.ts: no value reaches the SQL text.
    expect(compiled!.sql).not.toContain(String(SUBSTANTIAL_MIN_WORDS));
    expect(Object.values(compiled!.params)).toEqual([SUBSTANTIAL_MIN_WORDS]);
    // Every parameter the fragment names must be one it supplies, or the
    // statement throws at bind time.
    const named = [...compiled!.sql.matchAll(/@(\w+)/g)].map((match) => match[1]);
    expect(named.sort()).toEqual(Object.keys(compiled!.params).sort());
  });

  it("excludes encrypted entries and empty bodies in the SQL itself", () => {
    const { sql } = buildBodyLengthSql("substantial")!;
    expect(sql).toContain("e.is_encrypted = 0");
    expect(sql).toContain("length(trim(e.content)) > 0");
  });

  it("is a single parenthesised term, so an OR filter can't absorb it", () => {
    // The fragment is ANDed onto a WHERE whose own conditions may be joined with
    // OR. Without the wrapping parens it would become one more alternative.
    const { sql } = buildBodyLengthSql("substantial")!;
    expect(sql.startsWith("(")).toBe(true);
    expect(sql.endsWith(")")).toBe(true);
  });
});

describe("countBodyWords", () => {
  it("counts space-separated words", () => {
    expect(countBodyWords("hello")).toBe(1);
    expect(countBodyWords("a b c")).toBe(3);
    expect(countBodyWords(words(11))).toBe(11);
  });

  it("is 0 for an empty or whitespace-only body", () => {
    expect(countBodyWords("")).toBe(0);
    expect(countBodyWords("    ")).toBe(0);
  });

  it("ignores surrounding whitespace", () => {
    expect(countBodyWords("  hello world  ")).toBe(2);
  });

  it("agrees with isSubstantialBody at the boundary", () => {
    // The point of sharing the arithmetic: the number the column shows must
    // never contradict the condition that admitted (or excluded) the row.
    for (const n of [9, 10, 11, 12]) {
      const content = words(n);
      expect(countBodyWords(content)).toBe(n);
      expect(isSubstantialBody({ content, isEncrypted: false })).toBe(n > SUBSTANTIAL_MIN_WORDS);
    }
  });
});

describe("isSubstantialBody", () => {
  function body(content: string, isEncrypted = false) {
    return { content, isEncrypted };
  }

  it("lists a body of more than ten words", () => {
    expect(isSubstantialBody(body(words(11)))).toBe(true);
    expect(isSubstantialBody(body(words(50)))).toBe(true);
  });

  it("excludes a body of exactly ten words — 'longer than', not 'at least'", () => {
    expect(isSubstantialBody(body(words(10)))).toBe(false);
  });

  it("excludes a body shorter than the threshold", () => {
    expect(isSubstantialBody(body(words(1)))).toBe(false);
    expect(isSubstantialBody(body(words(9)))).toBe(false);
  });

  it("excludes an empty or whitespace-only body", () => {
    expect(isSubstantialBody(body(""))).toBe(false);
    expect(isSubstantialBody(body("     "))).toBe(false);
  });

  it("ignores leading and trailing whitespace when counting", () => {
    // Trimmed first, so padding can't push a ten-word body over the line.
    expect(isSubstantialBody(body(`   ${words(10)}   `))).toBe(false);
    expect(isSubstantialBody(body(`   ${words(11)}   `))).toBe(true);
  });

  it("excludes an encrypted entry whatever its content column holds", () => {
    // The column is blank in practice (migration 0131), but the rule is that a
    // sealed body can't be judged — so it holds even if text is present.
    expect(isSubstantialBody(body(words(50), true))).toBe(false);
    expect(isSubstantialBody(body("", true))).toBe(false);
  });

  it("counts consecutive spaces separately — a known, conservative limitation", () => {
    // Nine words with one double space reads as ten. Pinned so the behaviour is
    // a decision on record rather than a surprise if someone changes the split.
    expect(isSubstantialBody(body(words(9).replace(" ", "  ")))).toBe(false);
    expect(isSubstantialBody(body(words(10).replace(" ", "  ")))).toBe(true);
  });

  it("does not treat newlines as separators — the other known limitation", () => {
    // Twenty words, one per line, counts as one. Documented in body-length.ts.
    const perLine = Array.from({ length: 20 }, () => "x").join("\n");
    expect(isSubstantialBody(body(perLine))).toBe(false);
  });
});
