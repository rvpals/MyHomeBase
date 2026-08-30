// Spend over time: the month-over-month rollups behind the Charts screen's
// trend cards.
//
// Measured in **calendar months**, not billing cycles, and the distinction
// matters. A cycle belongs to one card — a card closing on the 28th and one
// closing on the 5th have different "Augusts" — so cycles give no shared x-axis
// to compare spend across cards or categories. A calendar month is the one
// period every card agrees on. Cycles stay the right unit for reconciling a
// single statement, which is what the grouped Transactions view already uses
// them for.
//
// Periods come from `transactionDate` (when the purchase happened) rather than
// `postingDate`: the purchase date is always populated, while plenty of card
// exports omit the posting date entirely, and it's what the rest of the module
// sorts by.
//
// Nothing here constructs a Date. A YYYY-MM period is a substring of a
// YYYY-MM-DD date, and month arithmetic is done on the parts — same reasoning as
// billing-cycle.ts, where routing dates through `new Date(...)` would reinterpret
// them in the runtime's timezone and move a purchase on the 1st into the
// previous month.
//
// Totals are **net**: a refund reduces its month, exactly as it reduces a group
// total in the grouped view. A gross-of-charges number would disagree with every
// other total in the module.

import type { ExpenseTransaction } from "./types";

/** How many months the trend chart shows by default — a year, so seasonality reads. */
export const DEFAULT_TREND_MONTHS = 12;

/** What an empty category is called in a trend rollup. Matches the grouped view. */
export const UNCATEGORISED_TREND_LABEL = "uncategorised";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** One calendar month of spend. */
export interface MonthlyTotal {
  /** YYYY-MM. Sorts chronologically as a plain string, and is the React key. */
  month: string;
  /** "Aug 2026". */
  label: string;
  /** Net of `amountCents` over the month; negative when refunds outweigh charges. */
  totalCents: number;
  transactionCount: number;
}

/** One category's movement between two months. */
export interface CategoryComparison {
  /** The stored name, or "" for uncategorised — the caller labels it. */
  categoryName: string;
  currentCents: number;
  previousCents: number;
  /** `current - previous`. Positive means more was spent this month. */
  changeCents: number;
  /**
   * Change as a fraction of the previous month, e.g. 0.25 for a quarter more.
   * Undefined when the previous month was zero: there is no percentage change
   * from nothing, and rendering one as "∞%" or "100%" would both be lies.
   */
  changeRatio: number | undefined;
}

/**
 * The YYYY-MM a date falls in, or undefined when the string isn't a date.
 *
 * Validated rather than sliced blindly: these are statement dates, and a blank
 * or malformed one is a row to set aside, not a crash. Same contract as
 * `cycleForDate`.
 */
export function monthOf(date: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date.trim());
  if (!match) return undefined;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return undefined;
  return `${match[1]}-${match[2]}`;
}

/** "2026-08" → "Aug 2026". Returns the input unchanged when it isn't a period. */
export function monthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const index = Number(match[2]) - 1;
  if (index < 0 || index > 11) return month;
  return `${MONTH_NAMES[index]} ${match[1]}`;
}

/** The period one month before `month`, rolling the year over. */
export function previousMonthOf(month: string): string | undefined {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return undefined;
  const year = Number(match[1]);
  const index = Number(match[2]);
  if (index < 1 || index > 12) return undefined;
  const previous = index === 1 ? { year: year - 1, month: 12 } : { year, month: index - 1 };
  return `${String(previous.year).padStart(4, "0")}-${String(previous.month).padStart(2, "0")}`;
}

/**
 * Every month between `from` and `to` inclusive, chronologically.
 *
 * Used to fill the gaps in a sparse history: a month you spent nothing in still
 * belongs on a time axis, and without it the chart would put two non-adjacent
 * months side by side and imply they were consecutive.
 */
export function monthRange(from: string, to: string): string[] {
  if (previousMonthOf(from) === undefined || previousMonthOf(to) === undefined) return [];
  if (from > to) return [];

  const months: string[] = [];
  let current = from;
  // Bounded by the range itself, but capped defensively — a malformed pair must
  // not spin here.
  while (current <= to && months.length < 1200) {
    months.push(current);
    const next = nextMonthOf(current);
    if (next === undefined) break;
    current = next;
  }
  return months;
}

/** The period one month after `month`, rolling the year over. */
function nextMonthOf(month: string): string | undefined {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return undefined;
  const year = Number(match[1]);
  const index = Number(match[2]);
  if (index < 1 || index > 12) return undefined;
  const next = index === 12 ? { year: year + 1, month: 1 } : { year, month: index + 1 };
  return `${String(next.year).padStart(4, "0")}-${String(next.month).padStart(2, "0")}`;
}

/**
 * Net spend per calendar month, oldest first, with empty months in between
 * filled in at zero.
 *
 * A month genuinely inside your history with no spend *is* a zero, so it is
 * charted as one — that's different from a month outside the range, which simply
 * isn't a row. Rows whose date can't be read are left out rather than pooled into
 * a bogus month.
 *
 * `limit` keeps the most recent N months. Applied after filling, so twelve months
 * means twelve columns whether or not you spent in all of them.
 */
export function monthlyTotals(
  transactions: ExpenseTransaction[],
  limit = DEFAULT_TREND_MONTHS,
): MonthlyTotal[] {
  const byMonth = new Map<string, { totalCents: number; transactionCount: number }>();

  for (const transaction of transactions) {
    const month = monthOf(transaction.transactionDate);
    if (month === undefined) continue;
    const existing = byMonth.get(month);
    if (existing) {
      existing.totalCents += transaction.amountCents;
      existing.transactionCount += 1;
    } else {
      byMonth.set(month, { totalCents: transaction.amountCents, transactionCount: 1 });
    }
  }

  if (byMonth.size === 0) return [];

  const present = [...byMonth.keys()].sort();
  const filled = monthRange(present[0], present[present.length - 1]);

  const totals = filled.map((month) => {
    const found = byMonth.get(month);
    return {
      month,
      label: monthLabel(month),
      totalCents: found?.totalCents ?? 0,
      transactionCount: found?.transactionCount ?? 0,
    };
  });

  return limit > 0 && totals.length > limit ? totals.slice(-limit) : totals;
}

/**
 * Net spend for one month, per category, biggest spend first.
 *
 * Uncategorised rows are kept, under "": a growing pile of them is itself worth
 * seeing, and dropping them would make the category totals disagree with the
 * month's own total.
 */
export function categoryTotalsForMonth(
  transactions: ExpenseTransaction[],
  month: string,
): Map<string, number> {
  const totals = new Map<string, number>();

  for (const transaction of transactions) {
    if (monthOf(transaction.transactionDate) !== month) continue;
    totals.set(
      transaction.categoryName,
      (totals.get(transaction.categoryName) ?? 0) + transaction.amountCents,
    );
  }

  return totals;
}

/**
 * Per-category movement from `previousMonth` to `currentMonth`, biggest absolute
 * change first — the ordering that puts what actually moved at the top, which is
 * the question this table exists to answer.
 *
 * A category present in only one of the two months still gets a row, with the
 * other side at zero. Those are the interesting ones: something you started or
 * stopped paying for.
 */
export function compareMonths(
  transactions: ExpenseTransaction[],
  currentMonth: string,
  previousMonth: string,
): CategoryComparison[] {
  const current = categoryTotalsForMonth(transactions, currentMonth);
  const previous = categoryTotalsForMonth(transactions, previousMonth);

  const names = new Set([...current.keys(), ...previous.keys()]);

  const rows = [...names].map((categoryName) => {
    const currentCents = current.get(categoryName) ?? 0;
    const previousCents = previous.get(categoryName) ?? 0;
    return {
      categoryName,
      currentCents,
      previousCents,
      changeCents: currentCents - previousCents,
      // No percentage from a zero base — see CategoryComparison.changeRatio.
      changeRatio: previousCents === 0 ? undefined : (currentCents - previousCents) / Math.abs(previousCents),
    };
  });

  return rows.sort((left, right) => Math.abs(right.changeCents) - Math.abs(left.changeCents));
}

/**
 * The most recent month present in the data, or undefined when nothing is dated.
 *
 * Taken from the transactions rather than from today's clock: a module you
 * haven't imported into for a while should compare the two months you actually
 * have, not show two empty ones.
 */
export function latestMonth(transactions: ExpenseTransaction[]): string | undefined {
  let latest: string | undefined;
  for (const transaction of transactions) {
    const month = monthOf(transaction.transactionDate);
    if (month === undefined) continue;
    if (latest === undefined || month > latest) latest = month;
  }
  return latest;
}
