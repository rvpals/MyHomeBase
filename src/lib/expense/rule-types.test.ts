import { describe, expect, it } from "vitest";
import {
  ALL_RULE_TYPES_FILTER,
  UNTYPED_RULE_FILTER,
  filterRulesByType,
  ruleTypeFilterOptions,
  ruleTypeNamesUsedBy,
} from "./rule-types";
import type { ExpenseRuleType, PostImportRule } from "./types";

const now = "2026-09-23T00:00:00.000Z";

function rule(id: number, typeName: string, priority = 0): PostImportRule {
  return {
    id,
    name: `rule ${id}`,
    description: "",
    typeName,
    pattern: `%P${id}%`,
    priority,
    isEnabled: true,
    actions: [],
    createdAt: now,
    updatedAt: now,
  };
}

function type(name: string, sortOrder = 0): ExpenseRuleType {
  return { name, description: "", sortOrder, createdAt: now, updatedAt: now };
}

describe("ruleTypeFilterOptions", () => {
  it("puts All first, with the total count", () => {
    const options = ruleTypeFilterOptions([rule(1, "Subs"), rule(2, "Food")], [type("Subs"), type("Food")]);

    expect(options[0]).toEqual({ value: ALL_RULE_TYPES_FILTER, label: "All", count: 2 });
  });

  it("counts the rules under each type", () => {
    const rules = [rule(1, "Subs"), rule(2, "Subs"), rule(3, "Food")];

    const options = ruleTypeFilterOptions(rules, [type("Subs"), type("Food")]);

    expect(options.slice(1)).toEqual([
      { value: "Subs", label: "Subs", count: 2 },
      { value: "Food", label: "Food", count: 1 },
    ]);
  });

  it("preserves the curated order rather than re-sorting it", () => {
    // The repository sorts by sort_order then name; the strip must not undo that.
    const types = [type("Zebra", 0), type("Apple", 1)];

    const options = ruleTypeFilterOptions([], types);

    expect(options.map((option) => option.label)).toEqual(["All", "Zebra", "Apple"]);
  });

  it("keeps a curated type with no rules, showing zero", () => {
    const options = ruleTypeFilterOptions([], [type("Subs")]);

    expect(options).toContainEqual({ value: "Subs", label: "Subs", count: 0 });
  });

  it("offers a type that only a rule references, so no rule is unreachable", () => {
    // The curated row was deleted; the rule still names it.
    const options = ruleTypeFilterOptions([rule(1, "Orphan")], []);

    expect(options).toContainEqual({ value: "Orphan", label: "Orphan", count: 1 });
  });

  it("appends stray types alphabetically, after the curated ones", () => {
    const rules = [rule(1, "Zed"), rule(2, "Ash"), rule(3, "Curated")];

    const options = ruleTypeFilterOptions(rules, [type("Curated")]);

    expect(options.map((option) => option.label)).toEqual(["All", "Curated", "Ash", "Zed"]);
  });

  it("adds Untyped last when something is untyped", () => {
    const options = ruleTypeFilterOptions([rule(1, "Subs"), rule(2, "")], [type("Subs")]);

    expect(options.at(-1)).toEqual({ value: UNTYPED_RULE_FILTER, label: "Untyped", count: 1 });
  });

  it("omits Untyped entirely when every rule has a type", () => {
    const options = ruleTypeFilterOptions([rule(1, "Subs")], [type("Subs")]);

    expect(options.map((option) => option.label)).not.toContain("Untyped");
  });

  it("does not turn the blank type into a pill of its own", () => {
    // '' is Untyped, handled separately — it must never appear as a nameless type.
    const options = ruleTypeFilterOptions([rule(1, "")], []);

    expect(options.map((option) => option.label)).toEqual(["All", "Untyped"]);
  });

  it("offers only All when there are no rules and no types", () => {
    expect(ruleTypeFilterOptions([], [])).toEqual([
      { value: ALL_RULE_TYPES_FILTER, label: "All", count: 0 },
    ]);
  });
});

describe("filterRulesByType", () => {
  const rules = [rule(1, "Subs"), rule(2, ""), rule(3, "Food"), rule(4, "Subs")];

  it("returns everything for the All sentinel", () => {
    expect(filterRulesByType(rules, ALL_RULE_TYPES_FILTER)).toHaveLength(4);
  });

  it("returns only the rules of the chosen type", () => {
    expect(filterRulesByType(rules, "Subs").map((r) => r.id)).toEqual([1, 4]);
  });

  it("treats the blank filter as Untyped", () => {
    expect(filterRulesByType(rules, UNTYPED_RULE_FILTER).map((r) => r.id)).toEqual([2]);
  });

  it("preserves the evaluation order the repository returned", () => {
    // Priority order is what decides which rule wins a match, so filtering must
    // not disturb it.
    const ordered = [rule(9, "Subs", 0), rule(4, "Subs", 5), rule(7, "Subs", 9)];

    expect(filterRulesByType(ordered, "Subs").map((r) => r.id)).toEqual([9, 4, 7]);
  });

  it("yields nothing for a type no rule uses, rather than falling back to all", () => {
    expect(filterRulesByType(rules, "Nope")).toEqual([]);
  });
});

describe("ruleTypeNamesUsedBy", () => {
  it("dedupes the names", () => {
    expect(ruleTypeNamesUsedBy([rule(1, "Subs"), rule(2, "Subs")])).toEqual(["Subs"]);
  });

  it("drops untyped and whitespace-only names", () => {
    expect(ruleTypeNamesUsedBy([rule(1, ""), rule(2, "   "), rule(3, "Food")])).toEqual(["Food"]);
  });

  it("returns an empty list for no rules", () => {
    expect(ruleTypeNamesUsedBy([])).toEqual([]);
  });
});
