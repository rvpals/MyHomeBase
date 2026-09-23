// Filtering the transaction-rules list by its Type, and working out which
// types the filter strip should offer.
//
// Pure — rules and a chosen filter in, the rules to show and the choices to
// offer out — so the screen's whole filtering behaviour is unit-testable
// without rendering anything.
//
// A rule's type is text (`PostImportRule.typeName`), and `''` means Untyped.
// Two consequences shape everything here:
//
//  1. A rule may name a type that is not in the curated `exp_rule_types` list —
//     saving a rule registers its type, but a row can still arrive from an
//     import or a hand-edited database. The filter strip is therefore built
//     from the union of the curated list and the types the rules actually use,
//     so no rule can end up unreachable behind a filter that isn't offered.
//  2. Untyped is a real choice, not a hidden state. It appears in the strip
//     whenever any rule is untyped.

import type { ExpenseRuleType, PostImportRule } from "./types";

/**
 * The filter meaning "don't filter". Not a valid type name — a type name is
 * `.trim().min(1)` — so it can never collide with a real one.
 */
export const ALL_RULE_TYPES_FILTER = "__all__";

/** The filter meaning "rules with no type". `''` is exactly what those rules store. */
export const UNTYPED_RULE_FILTER = "";

/** What an untyped rule is called on screen. */
export const UNTYPED_RULE_LABEL = "Untyped";

/** One choice in the rules list's filter strip. */
export interface RuleTypeFilterOption {
  /** The value to filter on — a type name, `''` for untyped, or the All sentinel. */
  value: string;
  /** What the strip shows. */
  label: string;
  /** How many rules this choice would show. Drives the count on each pill. */
  count: number;
}

/**
 * The choices the filter strip offers, in the order it shows them: **All**
 * first, then each type, then **Untyped** last.
 *
 * The type list is the union of the curated types and the types the rules
 * actually reference, so a rule whose type was deleted from the curated list
 * still has a pill to reach it by. Curated order is preserved (the repository
 * sorts by `sort_order` then name); any extra types found only on rules are
 * appended alphabetically, since they have no curated position to respect.
 *
 * A curated type with no rules still gets a pill, showing `0`. That is
 * deliberate: it is the user's own list, and silently hiding an entry they just
 * created reads as the save having failed.
 *
 * Untyped goes last and only appears when something is actually untyped —
 * an empty "Untyped (0)" is noise on a tidy setup.
 */
export function ruleTypeFilterOptions(
  rules: PostImportRule[],
  types: ExpenseRuleType[],
): RuleTypeFilterOption[] {
  const countByType = new Map<string, number>();
  for (const rule of rules) {
    countByType.set(rule.typeName, (countByType.get(rule.typeName) ?? 0) + 1);
  }

  const curated = types.map((type) => type.name);
  const curatedSet = new Set(curated);
  const strays = [...countByType.keys()]
    .filter((name) => name !== "" && !curatedSet.has(name))
    .sort((a, b) => a.localeCompare(b));

  const options: RuleTypeFilterOption[] = [
    { value: ALL_RULE_TYPES_FILTER, label: "All", count: rules.length },
    ...[...curated, ...strays].map((name) => ({
      value: name,
      label: name,
      count: countByType.get(name) ?? 0,
    })),
  ];

  const untypedCount = countByType.get(UNTYPED_RULE_FILTER) ?? 0;
  if (untypedCount > 0) {
    options.push({
      value: UNTYPED_RULE_FILTER,
      label: UNTYPED_RULE_LABEL,
      count: untypedCount,
    });
  }

  return options;
}

/**
 * The rules a given filter shows. Order is preserved — the repository already
 * returns rules by priority then id, which is the order they're evaluated in,
 * and filtering must not disturb that.
 *
 * An unknown filter value yields an empty list rather than falling back to
 * everything: if the strip offers a type and it matches nothing, "no rules"
 * is the honest answer. `ALL_RULE_TYPES_FILTER` is the only way to see all of
 * them.
 */
export function filterRulesByType(rules: PostImportRule[], filter: string): PostImportRule[] {
  if (filter === ALL_RULE_TYPES_FILTER) return rules;
  return rules.filter((rule) => rule.typeName === filter);
}

/**
 * The type names a set of rules references, deduped and with untyped dropped.
 * What the save path hands `registerRuleTypesIfMissing`, so a type typed
 * straight into the New Rule form joins the curated list.
 */
export function ruleTypeNamesUsedBy(rules: PostImportRule[]): string[] {
  const names = new Set<string>();
  for (const rule of rules) {
    if (rule.typeName.trim() !== "") names.add(rule.typeName);
  }
  return [...names];
}
