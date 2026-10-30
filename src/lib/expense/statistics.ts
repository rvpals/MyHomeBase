import type { CategoryTotal, ExpenseTransaction } from "./types";

// Categories the user has taken out of the statistics (spending totals, top
// vendors/categories, charts). The Transactions list is deliberately untouched, so
// an excluded row can still be found and reconciled.

/** Builds the lookup, ignoring blanks. Names match the stored category verbatim. */
function toExcludedSet(excluded: readonly string[]): Set<string> {
  return new Set(excluded.filter((name) => name !== ""));
}

/** Transactions that count toward statistics: those not in an excluded category. */
export function excludeCategoriesFromStats(
  transactions: ExpenseTransaction[],
  excluded: readonly string[],
): ExpenseTransaction[] {
  const set = toExcludedSet(excluded);
  if (set.size === 0) return transactions;
  return transactions.filter((transaction) => !set.has(transaction.categoryName));
}

/** The same filter for per-category rollups. */
export function excludeCategoryTotals(
  totals: CategoryTotal[],
  excluded: readonly string[],
): CategoryTotal[] {
  const set = toExcludedSet(excluded);
  if (set.size === 0) return totals;
  return totals.filter((total) => !set.has(total.categoryName));
}
