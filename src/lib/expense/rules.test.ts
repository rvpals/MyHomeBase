import { describe, expect, it } from "vitest";
import { compilePattern, findMatchingRule, matchesPattern, planRuleApplication } from "./rules";
import type { CategoryRule } from "./types";

function rule(overrides: Partial<CategoryRule> = {}): CategoryRule {
  return {
    id: 1,
    pattern: "AMAZON*",
    categoryName: "online-purchase",
    applyStatus: "",
    priority: 0,
    isEnabled: true,
    createdAt: "2026-08-01",
    updatedAt: "2026-08-01",
    ...overrides,
  };
}

describe("matchesPattern", () => {
  it("matches a trailing wildcard against real card text", () => {
    expect(matchesPattern("AMAZON MKTPL*2X4Y9", "AMAZON*")).toBe(true);
    expect(matchesPattern("AMAZON.COM*4T7G1", "AMAZON*")).toBe(true);
  });

  it("anchors a wildcard pattern, so a prefix pattern won't match mid-string", () => {
    expect(matchesPattern("PRIME VIDEO AMAZON", "AMAZON*")).toBe(false);
  });

  it("matches anywhere when the pattern has no wildcard", () => {
    expect(matchesPattern("SQ *BLUE BOTTLE COFFEE", "BLUE BOTTLE")).toBe(true);
    expect(matchesPattern("UBER   *TRIP HELP.UBER.COM", "UBER")).toBe(true);
  });

  it("supports a leading and trailing wildcard", () => {
    expect(matchesPattern("SQ *BLUE BOTTLE COFFEE", "*BLUE BOTTLE*")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesPattern("amazon mktpl", "AMAZON*")).toBe(true);
  });

  it("treats regex metacharacters in the description as literal text", () => {
    // Card descriptions are full of *, ., # and parentheses — a pattern must
    // never be interpreted as a regular expression.
    expect(matchesPattern("SHELL OIL 57445362(", "SHELL OIL 57445362(")).toBe(true);
    expect(matchesPattern("COSTCO WHSE #1234", "COSTCO WHSE #1234")).toBe(true);
    expect(matchesPattern("anything at all", "a.c")).toBe(false); // '.' is literal, not "any char"
  });

  it("does not match on a blank pattern", () => {
    expect(matchesPattern("AMAZON", "   ")).toBe(false);
  });
});

describe("compilePattern", () => {
  it("escapes a literal asterisk in the middle of a vendor name only as a wildcard", () => {
    // "SQ *" is a common prefix; as a pattern the * is a wildcard by design.
    expect(compilePattern("SQ *COFFEE").test("SQ *COFFEE")).toBe(true);
    expect(compilePattern("SQ *COFFEE").test("SQ MY COFFEE")).toBe(true);
  });
});

describe("findMatchingRule", () => {
  it("returns the first matching rule in the given order", () => {
    const rules = [
      rule({ id: 1, pattern: "AMAZON PRIME*", categoryName: "subscriptions", priority: 0 }),
      rule({ id: 2, pattern: "AMAZON*", categoryName: "online-purchase", priority: 1 }),
    ];
    expect(findMatchingRule("AMAZON PRIME*MEMBERSHIP", rules)?.categoryName).toBe("subscriptions");
    expect(findMatchingRule("AMAZON MKTPL*99", rules)?.categoryName).toBe("online-purchase");
  });

  it("skips disabled rules", () => {
    const rules = [rule({ isEnabled: false })];
    expect(findMatchingRule("AMAZON MKTPL", rules)).toBeUndefined();
  });

  it("returns undefined when nothing matches", () => {
    expect(findMatchingRule("LOCAL BAKERY", [rule()])).toBeUndefined();
  });
});

describe("planRuleApplication", () => {
  const uncategorised = {
    transactionDescription: "AMAZON MKTPL*2X4Y9",
    categoryName: "",
    status: "new" as const,
  };

  it("assigns the matched category and leaves status alone by default", () => {
    const plan = planRuleApplication(uncategorised, [rule()]);
    expect(plan).toMatchObject({ categoryName: "online-purchase", status: "new" });
  });

  it("applies the rule's status when it specifies one", () => {
    const plan = planRuleApplication(uncategorised, [rule({ applyStatus: "reconciled" })]);
    expect(plan?.status).toBe("reconciled");
  });

  it("never overwrites an existing category, so re-running rules is safe", () => {
    const plan = planRuleApplication({ ...uncategorised, categoryName: "groceries" }, [rule()]);
    expect(plan).toBeUndefined();
  });

  it("returns undefined when no rule matches", () => {
    const plan = planRuleApplication({ ...uncategorised, transactionDescription: "LOCAL BAKERY" }, [
      rule(),
    ]);
    expect(plan).toBeUndefined();
  });

  it("reports which rule decided, for the changed-rows summary", () => {
    const plan = planRuleApplication(uncategorised, [rule({ id: 7 })]);
    expect(plan?.rule.id).toBe(7);
  });
});
