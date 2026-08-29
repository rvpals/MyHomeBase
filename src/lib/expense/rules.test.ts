import { describe, expect, it } from "vitest";
import {
  applyAssignments,
  compilePattern,
  findMatchingRule,
  matchesPattern,
  planForcedRuleApplication,
  planRuleApplication,
  type TransactionFieldsForRules,
} from "./rules";
import type { PostImportRule, RuleAction, RuleActionField } from "./types";

function action(
  fieldName: RuleActionField,
  fieldValue: string,
  sortOrder = 0,
  id = sortOrder + 1,
): RuleAction {
  return { id, ruleId: 1, fieldName, fieldValue, sortOrder };
}

function rule(overrides: Partial<PostImportRule> = {}): PostImportRule {
  return {
    id: 1,
    name: "Amazon",
    description: "",
    pattern: "AMAZON*",
    priority: 0,
    isEnabled: true,
    actions: [action("categoryName", "online-purchase")],
    createdAt: "2026-08-02",
    updatedAt: "2026-08-02",
    ...overrides,
  };
}

function transaction(
  overrides: Partial<TransactionFieldsForRules> = {},
): TransactionFieldsForRules {
  return {
    transactionDescription: "AMAZON MKTPL*2X4Y9",
    categoryName: "",
    vendor: "",
    note: "",
    status: "new",
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
    expect(matchesPattern("SQ *TGI FRIDAYS #221", "TGI")).toBe(true);
    expect(matchesPattern("UBER   *TRIP HELP.UBER.COM", "UBER")).toBe(true);
  });

  it("supports a leading and trailing wildcard", () => {
    expect(matchesPattern("SQ *TGI FRIDAYS #221", "*TGI*")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesPattern("amazon mktpl", "AMAZON*")).toBe(true);
  });

  it("treats regex metacharacters in the description as literal text", () => {
    expect(matchesPattern("SHELL OIL 57445362(", "SHELL OIL 57445362(")).toBe(true);
    expect(matchesPattern("COSTCO WHSE #1234", "COSTCO WHSE #1234")).toBe(true);
    expect(matchesPattern("anything at all", "a.c")).toBe(false); // '.' is literal
  });

  it("does not match on a blank pattern", () => {
    expect(matchesPattern("AMAZON", "   ")).toBe(false);
  });
});

describe("compilePattern", () => {
  it("treats an asterisk inside a vendor name as a wildcard", () => {
    expect(compilePattern("SQ *COFFEE").test("SQ *COFFEE")).toBe(true);
    expect(compilePattern("SQ *COFFEE").test("SQ MY COFFEE")).toBe(true);
  });
});

describe("findMatchingRule", () => {
  it("returns the first matching rule in the given order", () => {
    const rules = [
      rule({ id: 1, pattern: "AMAZON PRIME*", priority: 0 }),
      rule({ id: 2, pattern: "AMAZON*", priority: 1 }),
    ];
    expect(findMatchingRule("AMAZON PRIME*MEMBERSHIP", rules)?.id).toBe(1);
    expect(findMatchingRule("AMAZON MKTPL*99", rules)?.id).toBe(2);
  });

  it("skips disabled rules", () => {
    expect(findMatchingRule("AMAZON MKTPL", [rule({ isEnabled: false })])).toBeUndefined();
  });

  it("returns undefined when nothing matches", () => {
    expect(findMatchingRule("LOCAL BAKERY", [rule()])).toBeUndefined();
  });
});

describe("planRuleApplication", () => {
  it("plans every field the matching rule sets", () => {
    const tgi = rule({
      pattern: "*TGI*",
      actions: [action("vendor", "TGI Friday", 0), action("categoryName", "Restaurant", 1)],
    });

    const plan = planRuleApplication(transaction({ transactionDescription: "SQ *TGI FRIDAYS" }), [tgi]);

    expect(plan?.rule.pattern).toBe("*TGI*");
    expect(plan?.assignments).toEqual([
      { fieldName: "vendor", value: "TGI Friday" },
      { fieldName: "categoryName", value: "Restaurant" },
    ]);
  });

  it("applies assignments in sortOrder, not database order", () => {
    const out = rule({
      actions: [action("categoryName", "second", 1, 10), action("vendor", "first", 0, 11)],
    });
    const plan = planRuleApplication(transaction(), [out]);
    expect(plan?.assignments.map((a) => a.fieldName)).toEqual(["vendor", "categoryName"]);
  });

  it("skips a field that already has a value, so manual edits survive", () => {
    const both = rule({
      actions: [action("vendor", "Amazon", 0), action("categoryName", "online-purchase", 1)],
    });

    const plan = planRuleApplication(transaction({ vendor: "My Own Vendor" }), [both]);

    expect(plan?.assignments).toEqual([{ fieldName: "categoryName", value: "online-purchase" }]);
  });

  it("treats status 'new' as unset but leaves any other status alone", () => {
    const setStatus = rule({ actions: [action("status", "reconciled")] });

    expect(planRuleApplication(transaction(), [setStatus])?.assignments).toEqual([
      { fieldName: "status", value: "reconciled" },
    ]);
    expect(
      planRuleApplication(transaction({ status: "irreconcilable" }), [setStatus])?.assignments,
    ).toEqual([]);
  });

  it("returns a plan with no assignments when the rule matches but nothing is free", () => {
    const plan = planRuleApplication(
      transaction({ categoryName: "already-set" }),
      [rule()],
    );
    // Matched, so the row counts as processed — it just doesn't change.
    expect(plan).toBeDefined();
    expect(plan?.assignments).toEqual([]);
  });

  it("uses the first entry when a rule lists the same field twice", () => {
    const duplicated = rule({
      actions: [action("vendor", "First", 0), action("vendor", "Second", 1)],
    });
    expect(planRuleApplication(transaction(), [duplicated])?.assignments).toEqual([
      { fieldName: "vendor", value: "First" },
    ]);
  });

  it("returns undefined when no rule matches", () => {
    expect(
      planRuleApplication(transaction({ transactionDescription: "LOCAL BAKERY" }), [rule()]),
    ).toBeUndefined();
  });
});

describe("applyAssignments", () => {
  it("writes each planned field onto a copy of the row", () => {
    const original = transaction();
    const updated = applyAssignments(original, [
      { fieldName: "vendor", value: "TGI Friday" },
      { fieldName: "categoryName", value: "Restaurant" },
      { fieldName: "status", value: "reconciled" },
    ]);

    expect(updated).toMatchObject({
      vendor: "TGI Friday",
      categoryName: "Restaurant",
      status: "reconciled",
    });
    expect(original.vendor).toBe(""); // input untouched
  });
});

describe("planForcedRuleApplication", () => {
  it("overwrites a field that already holds a different value", () => {
    const plan = planForcedRuleApplication(
      transaction({ categoryName: "groceries" }),
      rule({ actions: [action("categoryName", "online-purchase")] }),
    );
    expect(plan?.assignments).toEqual([{ fieldName: "categoryName", value: "online-purchase" }]);
  });

  it("skips a field that already holds the value the rule would write", () => {
    const plan = planForcedRuleApplication(
      transaction({ categoryName: "online-purchase" }),
      rule({ actions: [action("categoryName", "online-purchase")] }),
    );
    expect(plan?.assignments).toEqual([]);
  });

  it("never overwrites a status the user has already moved off new", () => {
    const plan = planForcedRuleApplication(
      transaction({ status: "reconciled", vendor: "old" }),
      rule({ actions: [action("status", "new", 0), action("vendor", "Amazon", 1)] }),
    );
    expect(plan?.assignments).toEqual([{ fieldName: "vendor", value: "Amazon" }]);
  });

  it("still sets status on a row that is untouched", () => {
    const plan = planForcedRuleApplication(
      transaction({ status: "new" }),
      rule({ actions: [action("status", "reconciled")] }),
    );
    expect(plan?.assignments).toEqual([{ fieldName: "status", value: "reconciled" }]);
  });

  it("uses the first action when a rule names the same field twice", () => {
    const plan = planForcedRuleApplication(
      transaction({ vendor: "old" }),
      rule({ actions: [action("vendor", "First", 0), action("vendor", "Second", 1)] }),
    );
    expect(plan?.assignments).toEqual([{ fieldName: "vendor", value: "First" }]);
  });

  it("returns undefined when the description doesn't match the pattern", () => {
    expect(
      planForcedRuleApplication(transaction({ transactionDescription: "SQ *TGI" }), rule()),
    ).toBeUndefined();
  });

  it("ignores priority and the enabled flag — the caller picked this rule", () => {
    const plan = planForcedRuleApplication(
      transaction({ vendor: "old" }),
      rule({ isEnabled: false, actions: [action("vendor", "Amazon")] }),
    );
    expect(plan?.assignments).toEqual([{ fieldName: "vendor", value: "Amazon" }]);
  });
});
