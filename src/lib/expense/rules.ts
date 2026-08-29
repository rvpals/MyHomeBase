// Post-import processing: matching a statement description against a rule, and
// working out which fields that rule would set. Pure — patterns and rows in,
// decisions out — so every quirk is unit-testable.

import type {
  ExpenseTransaction,
  PostImportRule,
  RuleActionField,
  TransactionStatus,
} from "./types";

/**
 * Compiles a user-written pattern into a matcher against a card's raw vendor
 * text.
 *
 * Two behaviours, chosen so the common case needs no punctuation:
 *  - **With `*`** the pattern is anchored and `*` matches any run of characters,
 *    so `AMAZON*` matches "AMAZON MKTPL*2X4Y" but not "PRIME AMAZON".
 *  - **Without any `*`** the pattern matches anywhere in the description, so a
 *    bare `TGI` behaves like `*TGI*`. Typing a vendor name and getting no
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
  rules: PostImportRule[],
): PostImportRule | undefined {
  return rules.find((rule) => rule.isEnabled && matchesPattern(description, rule.pattern));
}

/** One field the rule will change, with the value it will be set to. */
export interface PlannedAssignment {
  fieldName: RuleActionField;
  value: string;
}

export interface RulePlan {
  rule: PostImportRule;
  /** Only the fields that will actually change — may be empty. */
  assignments: PlannedAssignment[];
}

/**
 * Whether a field is free for a rule to fill in. Rules only populate *blank*
 * fields so they never overwrite something entered by hand, which is what makes
 * re-running them safe. For status, "new" is the blank equivalent — it's the
 * default every row starts on.
 */
function isFieldUnset(transaction: TransactionFieldsForRules, fieldName: RuleActionField): boolean {
  switch (fieldName) {
    case "categoryName":
      return transaction.categoryName.trim() === "";
    case "vendor":
      return transaction.vendor.trim() === "";
    case "note":
      return transaction.note.trim() === "";
    case "status":
      return transaction.status === "new";
    default:
      return false;
  }
}

/** The parts of a transaction the rules look at. */
export type TransactionFieldsForRules = Pick<
  ExpenseTransaction,
  "transactionDescription" | "categoryName" | "vendor" | "note" | "status"
>;

/**
 * Works out what the first matching rule would change on this transaction.
 * Returns undefined when nothing matches; returns a plan with an empty
 * `assignments` list when a rule matches but every field it sets is already
 * filled in — the caller still counts that as processed.
 */
export function planRuleApplication(
  transaction: TransactionFieldsForRules,
  rules: PostImportRule[],
): RulePlan | undefined {
  const rule = findMatchingRule(transaction.transactionDescription, rules);
  if (!rule) return undefined;

  const assignments: PlannedAssignment[] = [];
  const seen = new Set<RuleActionField>();

  for (const action of [...rule.actions].sort((a, b) => a.sortOrder - b.sortOrder)) {
    // A rule listing the same field twice uses the first one, so the outcome
    // doesn't depend on row order in the database.
    if (seen.has(action.fieldName)) continue;
    seen.add(action.fieldName);
    if (!isFieldUnset(transaction, action.fieldName)) continue;
    assignments.push({ fieldName: action.fieldName, value: action.fieldValue });
  }

  return { rule, assignments };
}

/** Applies planned assignments to a copy of the row's rule-visible fields. */
export function applyAssignments<T extends TransactionFieldsForRules>(
  transaction: T,
  assignments: PlannedAssignment[],
): T {
  const next = { ...transaction };
  for (const assignment of assignments) {
    if (assignment.fieldName === "status") {
      next.status = assignment.value as TransactionStatus;
    } else {
      next[assignment.fieldName] = assignment.value;
    }
  }
  return next;
}

/**
 * Works out what a *single named rule* would change on this transaction when
 * run deliberately, overwriting what's already there.
 *
 * Three differences from `planRuleApplication`, all of them the point of the
 * "Update Trans" button:
 *  - The rule is given rather than chosen, so priority and the "first match
 *    wins" order don't apply — you asked for *this* rule.
 *  - Filled-in fields are overwritten, so a corrected rule can fix rows an
 *    earlier version of it got wrong.
 *  - `status` is the exception and keeps the blank-only guard, because it's
 *    workflow state rather than a label: a force-apply must never knock a row
 *    you've already reconciled back to `new`. Nothing in the app can undo that.
 *
 * Returns undefined when the description doesn't match. Assignments that would
 * write the value already there are dropped, so a caller counting changed rows
 * counts real changes.
 */
export function planForcedRuleApplication(
  transaction: TransactionFieldsForRules,
  rule: PostImportRule,
): RulePlan | undefined {
  if (!matchesPattern(transaction.transactionDescription, rule.pattern)) return undefined;

  const assignments: PlannedAssignment[] = [];
  const seen = new Set<RuleActionField>();

  for (const action of [...rule.actions].sort((a, b) => a.sortOrder - b.sortOrder)) {
    // Same first-one-wins de-dupe as the normal plan, for the same reason: the
    // outcome mustn't depend on row order in the database.
    if (seen.has(action.fieldName)) continue;
    seen.add(action.fieldName);
    // Workflow state is never overwritten — see the note above.
    if (action.fieldName === "status" && !isFieldUnset(transaction, "status")) continue;
    if (currentValue(transaction, action.fieldName) === action.fieldValue) continue;
    assignments.push({ fieldName: action.fieldName, value: action.fieldValue });
  }

  return { rule, assignments };
}

/** The value a rule-visible field holds right now, as a string. */
function currentValue(
  transaction: TransactionFieldsForRules,
  fieldName: RuleActionField,
): string {
  switch (fieldName) {
    case "categoryName":
      return transaction.categoryName;
    case "vendor":
      return transaction.vendor;
    case "note":
      return transaction.note;
    case "status":
      return transaction.status;
    default:
      return "";
  }
}
