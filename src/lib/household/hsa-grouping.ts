// Grouping HSA expenses by year or by type, for the Receipts screen's "By year" and
// "By type" views. Pure — the view only renders what this returns.
//
// Modelled on `src/lib/expense/grouping.ts`, deliberately smaller: two groupings, each
// its own function, and the group's label *is* its key — no namespaced keys.

import { HSA_TYPES, type HsaExpense } from "./hsa-types";

/** What a row whose date cannot be read groups under. */
export const UNDATED_YEAR_LABEL = "No usable date";

export interface HsaExpenseGroup {
  /** The group's label — a year, a type, or `UNDATED_YEAR_LABEL`. Stable identity and the React key. */
  key: string;
  /** Sum of `amountCents` over `rows`. */
  totalCents: number;
  /** Sum over the rows still waiting to be reimbursed — the number worth chasing. */
  unreimbursedCents: number;
  expenseCount: number;
  /** How many carry a receipt file. */
  receiptCount: number;
  /** The group's expenses, newest first. */
  rows: HsaExpense[];
}

/** A year group is just a group keyed by year; the name is kept for existing callers. */
export type HsaYearGroup = HsaExpenseGroup;

/**
 * The year an expense belongs to.
 *
 * Read off the first four characters of the stored `YYYY-MM-DD` rather than through a
 * `Date`: these are calendar days somebody chose, and constructing a local `Date` from
 * one would shift it west of UTC and file a 1 January expense under the previous year.
 * The same rule the Journal's calendar follows.
 *
 * A row whose date is unreadable is grouped rather than dropped — it is still money.
 */
export function yearOf(expense: HsaExpense): string {
  const year = expense.entryDate.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : UNDATED_YEAR_LABEL;
}

/**
 * Groups expenses by year, latest first, with each year's rows newest first.
 *
 * Undated rows sort last whatever they are called: they have no year to place them
 * against, and leading the list with them would bury the current year.
 */
export function groupHsaExpensesByYear(expenses: HsaExpense[]): HsaExpenseGroup[] {
  return groupBy(expenses, yearOf).sort((left, right) => {
    if (left.key === UNDATED_YEAR_LABEL) return 1;
    if (right.key === UNDATED_YEAR_LABEL) return -1;
    return right.key.localeCompare(left.key);
  });
}

/**
 * Groups expenses by type, in the order the editor offers the types (`HSA_TYPES`),
 * with each type's rows newest first. Types with no expenses are left out.
 *
 * A type outside `HSA_TYPES` (older data, a renamed type) is grouped rather than
 * dropped — it is still money — and sorts after the known types, alphabetically.
 */
export function groupHsaExpensesByType(expenses: HsaExpense[]): HsaExpenseGroup[] {
  const known: readonly string[] = HSA_TYPES;
  const rank = (key: string) => {
    const index = known.indexOf(key);
    return index === -1 ? known.length : index;
  };
  return groupBy(expenses, (expense) => expense.type).sort(
    (left, right) => rank(left.key) - rank(right.key) || left.key.localeCompare(right.key),
  );
}

/** Buckets by `keyOf`, totals each bucket and orders its rows newest first. Buckets unsorted. */
function groupBy(expenses: HsaExpense[], keyOf: (expense: HsaExpense) => string): HsaExpenseGroup[] {
  const buckets = new Map<string, HsaExpense[]>();
  for (const expense of expenses) {
    const key = keyOf(expense);
    const existing = buckets.get(key);
    if (existing) existing.push(expense);
    else buckets.set(key, [expense]);
  }

  return [...buckets.entries()].map(([key, rows]): HsaExpenseGroup => {
    const sorted = [...rows].sort((left, right) =>
      `${right.entryDate} ${right.entryTime}`.localeCompare(`${left.entryDate} ${left.entryTime}`),
    );
    return {
      key,
      totalCents: sorted.reduce((sum, row) => sum + row.amountCents, 0),
      unreimbursedCents: sorted
        .filter((row) => !row.isReimbursed)
        .reduce((sum, row) => sum + row.amountCents, 0),
      expenseCount: sorted.length,
      receiptCount: sorted.filter((row) => row.hasReceipt).length,
      rows: sorted,
    };
  });
}
