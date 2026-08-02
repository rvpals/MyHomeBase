// Fuzzy vendor matching for auto-categorisation. Pure: patterns and text in,
// decisions out. No I/O, so every matching quirk is unit-testable.

import type { CategoryRule, ExpenseTransaction, TransactionStatus } from "./types";

/**
 * Compiles a user-written pattern into a matcher against a card's raw vendor
 * text.
 *
 * Two behaviours, chosen so the common case needs no punctuation:
 *  - **With `*`** the pattern is anchored and `*` matches any run of characters,
 *    so `AMAZON*` matches "AMAZON MKTPL*2X4Y" but not "PRIME AMAZON".
 *  - **Without any `*`** the pattern matches anywhere in the description, so a
 *    bare `UBER` behaves like `*UBER*`. Typing a vendor name and getting no
 *    matches would be a trap.
 *
 * Matching is case-insensitive, and every other regex metacharacter is escaped —
 * card descriptions are full of `*`, `.`, `#` and `(`, so a pattern is never
 * treated as a regular expression.
 */
export function compilePattern(pattern: string): RegExp {
  const trimmed = pattern.trim();
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The escape above turned every literal * into \*; turn those back into
  // wildcards. Nothing else can produce a \* sequence.
  const withWildcards = escaped.replace(/\\\*/g, "[\\s\\S]*");
  const body = trimmed.includes("*") ? `^${withWildcards}$` : `[\\s\\S]*${withWildcards}[\\s\\S]*`;
  return new RegExp(body, "i");
}

/** True when `description` satisfies `pattern`. A blank pattern never matches. */
export function matchesPattern(description: string, pattern: string): boolean {
  if (pattern.trim() === "") return false;
  return compilePattern(pattern).test(description);
}

/**
 * The first enabled rule matching this description, by ascending priority then
 * id (the order the repository returns). Returns undefined when none match.
 */
export function findMatchingRule(
  description: string,
  rules: CategoryRule[],
): CategoryRule | undefined {
  return rules.find((rule) => rule.isEnabled && matchesPattern(description, rule.pattern));
}

export interface RuleApplication {
  categoryName: string;
  status: TransactionStatus;
  /** The rule that decided this, for reporting what changed and why. */
  rule: CategoryRule;
}

/**
 * Works out what a rule would do to one transaction, or undefined if nothing
 * would change. A rule only fills in a *blank* category — an existing
 * categorisation (yours, or an earlier rule's) is never overwritten, so
 * re-running rules is safe and repeatable.
 */
export function planRuleApplication(
  transaction: Pick<ExpenseTransaction, "transactionDescription" | "categoryName" | "status">,
  rules: CategoryRule[],
): RuleApplication | undefined {
  if (transaction.categoryName.trim() !== "") return undefined;

  const rule = findMatchingRule(transaction.transactionDescription, rules);
  if (!rule) return undefined;

  const status = rule.applyStatus === "" ? transaction.status : rule.applyStatus;
  return { categoryName: rule.categoryName, status, rule };
}
