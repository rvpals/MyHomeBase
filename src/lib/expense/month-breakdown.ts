// One month's spend, split by category — the rollup behind the Charts screen's
// "Expense type By Month" tab.
//
// A sibling of `trends.ts` rather than part of it: trends answer "how did this
// move across months", this answers "where did one month's money go". Both read
// the same calendar-month period and the same `monthOf`/`monthLabel` helpers, so
// the two tabs can never disagree about which rows belong to August.
//
// Everything `trends.ts` says about periods applies here verbatim: periods come
// from `transactionDate`, nothing constructs a `Date` (a YYYY-MM period is a
// substring of a YYYY-MM-DD date, and routing one through `new Date(...)` would
// reinterpret it in the runtime's timezone and move a purchase on the 1st into
// the previous month), and totals are net so a refund reduces its category.
//
// The one rule that is this file's own: **a pie charts spend, so a category in
// credit gets no slice.** A negative share has nowhere to sit in a part-to-whole
// form. Such categories are still returned, flagged, because the companion table
// prints every category and its numbers have to reconcile with the month's own
// total — they just don't reach the chart. Same exclusion the category and
// vendor charts already make, for the same reason.

import { monthLabel, monthOf } from "./trends";
import type { ExpenseTransaction } from "./types";

/** One category's spend within a single month. */
export interface MonthCategorySlice {
  /** The stored name, or "" for uncategorised — the caller labels it. */
  categoryName: string;
  /** Net of `amountCents` over the month; negative when refunds outweigh charges. */
  totalCents: number;
  /**
   * This category's share of the month's **charted** spend, 0–1.
   *
   * Of the positive-spend total rather than the net total, so the shares of the
   * charted slices sum to 1 and match what the donut draws. A category in credit
   * gets 0 — it has no share of a whole it isn't part of.
   */
  share: number;
  /** False when the category is net negative, i.e. in credit and not chartable. */
  isSpend: boolean;
  transactionCount: number;
}

/** Everything the month tab needs for one month. */
export interface MonthCategoryBreakdown {
  /** YYYY-MM. */
  month: string;
  /** "Aug 2026". */
  label: string;
  /**
   * Every category with activity this month, biggest spend first, credits last.
   * Includes "" (uncategorised) when the month has uncategorised rows.
   */
  slices: MonthCategorySlice[];
  /** Net of every row in the month, credits included — what the month really cost. */
  netCents: number;
  /** Sum of the positive-spend categories only — the whole the shares divide. */
  spendCents: number;
  /**
   * The largest spending category, or undefined when the month has no positive
   * spend at all. What the tab calls out above the chart.
   */
  biggest: MonthCategorySlice | undefined;
  transactionCount: number;
}

/**
 * Split one month's transactions by category, biggest spend first.
 *
 * Returns a breakdown even for a month with no rows — an empty month is a real
 * answer ("you spent nothing in February"), not a missing one, and the caller
 * still needs the label to render its header. Rows whose date can't be read are
 * left out rather than pooled into a bogus month, matching `monthlyTotals`.
 */
export function monthCategoryBreakdown(
  transactions: ExpenseTransaction[],
  month: string,
): MonthCategoryBreakdown {
  const byCategory = new Map<string, { totalCents: number; transactionCount: number }>();
  let netCents = 0;
  let transactionCount = 0;

  for (const transaction of transactions) {
    if (monthOf(transaction.transactionDate) !== month) continue;

    netCents += transaction.amountCents;
    transactionCount += 1;

    const existing = byCategory.get(transaction.categoryName);
    if (existing) {
      existing.totalCents += transaction.amountCents;
      existing.transactionCount += 1;
    } else {
      byCategory.set(transaction.categoryName, {
        totalCents: transaction.amountCents,
        transactionCount: 1,
      });
    }
  }

  // The whole the shares divide: positive categories only, so the charted slices
  // sum to 100% instead of being inflated by credits they don't include.
  let spendCents = 0;
  for (const totals of byCategory.values()) {
    if (totals.totalCents > 0) spendCents += totals.totalCents;
  }

  const slices: MonthCategorySlice[] = [...byCategory.entries()].map(([categoryName, totals]) => ({
    categoryName,
    totalCents: totals.totalCents,
    // Guarded: a month of nothing but refunds has a zero whole to divide by.
    share: totals.totalCents > 0 && spendCents > 0 ? totals.totalCents / spendCents : 0,
    isSpend: totals.totalCents > 0,
    transactionCount: totals.transactionCount,
  }));

  // Spend first and biggest-first within it, then the credits — which sort
  // biggest-refund-first for the same reason, so the table's tail is ordered too.
  slices.sort((left, right) => {
    if (left.isSpend !== right.isSpend) return left.isSpend ? -1 : 1;
    return right.totalCents - left.totalCents;
  });

  const biggest = slices.length > 0 && slices[0].isSpend ? slices[0] : undefined;

  return {
    month,
    label: monthLabel(month),
    slices,
    netCents,
    spendCents,
    biggest,
    transactionCount,
  };
}

/**
 * Every month that actually has transactions, oldest first.
 *
 * Deliberately *not* gap-filled, unlike `monthRange` behind the trend line. This
 * feeds a month picker, and an empty month is not worth offering — the ‹ › steppers
 * can still walk into one (they step the calendar, not this list), and landing on
 * an empty month is a legitimate answer the tab renders as "nothing this month".
 */
export function monthsPresent(transactions: ExpenseTransaction[]): string[] {
  const months = new Set<string>();
  for (const transaction of transactions) {
    const month = monthOf(transaction.transactionDate);
    if (month !== undefined) months.add(month);
  }
  return [...months].sort();
}

/**
 * The YYYY-MM the given clock time falls in, in **local** time.
 *
 * The month tab opens on the real current month rather than on the newest month
 * in the data — that is the deliberate difference from the Month-on-month card,
 * which compares the two months you actually have. "This month so far" is the
 * question this tab answers, and it stays the honest answer even when the month
 * is empty because nothing has been imported yet.
 *
 * Local parts, not `toISOString()`: the latter is UTC, so on the 1st of a month
 * a user west of Greenwich would open the tab on the previous month.
 */
export function currentMonth(now: Date = new Date()): string {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
