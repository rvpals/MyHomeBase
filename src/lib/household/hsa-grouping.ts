// Grouping HSA expenses by year, for the Receipts screen's "By year" view. Pure — the
// view only renders what this returns.
//
// Modelled on `src/lib/expense/grouping.ts`, deliberately smaller: there is one
// grouping here, not five, so there is no `groupBy` discriminator and no namespaced
// key — the year *is* the key.

import type { HsaExpense } from "./hsa-types";

/** What a row whose date cannot be read groups under. */
export const UNDATED_YEAR_LABEL = "No usable date";

export interface HsaYearGroup {
  /** The four-digit year, or `UNDATED_YEAR_LABEL`. Stable identity and the React key. */
  key: string;
  /** Sum of `amountCents` over `rows`. */
  totalCents: number;
  /** Sum over the rows still waiting to be reimbursed — the number worth chasing. */
  unreimbursedCents: number;
  expenseCount: number;
  /** How many carry a receipt file. */
  receiptCount: number;
  /** The year's expenses, newest first. */
  rows: HsaExpense[];
}

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
export function groupHsaExpensesByYear(expenses: HsaExpense[]): HsaYearGroup[] {
  const byYear = new Map<string, HsaExpense[]>();
  for (const expense of expenses) {
    const key = yearOf(expense);
    const existing = byYear.get(key);
    if (existing) existing.push(expense);
    else byYear.set(key, [expense]);
  }

  const groups = [...byYear.entries()].map(([key, rows]): HsaYearGroup => {
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

  return groups.sort((left, right) => {
    if (left.key === UNDATED_YEAR_LABEL) return 1;
    if (right.key === UNDATED_YEAR_LABEL) return -1;
    return right.key.localeCompare(left.key);
  });
}
