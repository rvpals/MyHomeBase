// "What did we spend around this date?" — the Expense module's answer to a
// question asked from *outside* it. The Journal's entry viewer and its calendar
// both land here, and so does /modules/expense/transactions?date=.
//
// Pure, and deliberately so: every function takes rows and returns rows, which
// is what lets the same window be built by a server action, by the Transactions
// screen from the list it already holds, and by a test with no database.

import { parseIsoDateLocal, shiftIsoDate } from "../shared/date";
import type { CreditCardAccount, ExpenseTransaction } from "./types";

/**
 * How many days either side of the asked-for date the window covers, when the
 * caller doesn't say.
 *
 * One, not zero, because a card transaction and the day it was *lived* rarely
 * line up: a Saturday dinner reaches the statement with Saturday's date, but a
 * Sunday-evening purchase often carries Monday's. A ±1 window catches both
 * without widening far enough to drag in a different weekend.
 */
export const DEFAULT_EXPENSE_DATE_WINDOW_DAYS = 1;

/**
 * The widest window a caller may ask for. A URL parameter reaches this, and an
 * unbounded `?days=` is a way to ask the server for every row in the table
 * through a screen that promises one day's worth.
 */
export const MAX_EXPENSE_DATE_WINDOW_DAYS = 31;

/** Inclusive ISO bounds on `transaction_date`, ready for a `TransactionFilter`. */
export interface ExpenseDateWindow {
  /** The date that was asked for — the middle of the window, not its start. */
  date: string;
  /** Days either side. 0 means the window is exactly `date`. */
  days: number;
  from: string;
  to: string;
}

/**
 * Resolves "this date, give or take a day or two" into inclusive bounds.
 *
 * Throws on a date it can't read. The callers that take the date from a URL
 * catch that and show their empty state — a hand-mangled `?date=` should not be
 * a 500 — but the function itself refuses to guess, because silently falling
 * back to today would show a day's spending under another day's heading.
 *
 * `days` is clamped rather than rejected: it is a width, and a nonsensical one
 * has an obvious nearest sensible value, where a nonsensical *date* does not.
 */
export function resolveExpenseDateWindow(
  date: string,
  days: number = DEFAULT_EXPENSE_DATE_WINDOW_DAYS,
): ExpenseDateWindow {
  // Throws on a malformed or impossible date (2026-02-31), before any arithmetic.
  parseIsoDateLocal(date);
  const trimmed = date.trim();

  const requested = Number.isFinite(days) ? Math.trunc(days) : DEFAULT_EXPENSE_DATE_WINDOW_DAYS;
  const width = Math.min(Math.max(requested, 0), MAX_EXPENSE_DATE_WINDOW_DAYS);

  return {
    date: trimmed,
    days: width,
    from: shiftIsoDate(trimmed, -width),
    to: shiftIsoDate(trimmed, width),
  };
}

/** One transaction, flattened for display — no ids, no lookups left to do. */
export interface DayExpenseRow {
  id: number;
  /** This row's own `transaction_date`, which a window wider than a day needs. */
  date: string;
  /** The tidied vendor name, falling back to the raw statement text. */
  vendor: string;
  /** The raw statement line, always — it is what a vendor name was derived from. */
  description: string;
  /** Empty means "not categorised yet". */
  categoryName: string;
  /** The card's name, or "" when the account row has since been deleted. */
  accountName: string;
  /** Charges positive, credits/refunds negative. */
  amountCents: number;
}

/** Everything the day dialog renders, with nothing left for the view to compute. */
export interface ExpensesOnDateView {
  window: ExpenseDateWindow;
  rows: DayExpenseRow[];
  /** Sum of every row's amount — charges less refunds, so it can be negative. */
  totalCents: number;
}

/**
 * Narrows `transactions` to the window's inclusive bounds.
 *
 * A plain string comparison, which is exactly right for zero-padded ISO dates
 * and is the same comparison the repository's SQL does — so the filtered-in-SQL
 * path and this in-memory one can never disagree about which rows belong.
 */
export function transactionsInDateWindow(
  transactions: readonly ExpenseTransaction[],
  window: ExpenseDateWindow,
): ExpenseTransaction[] {
  return transactions.filter(
    (transaction) =>
      transaction.transactionDate >= window.from && transaction.transactionDate <= window.to,
  );
}

/**
 * Builds the view model for one date window: the rows, in reading order, and
 * their total.
 *
 * Takes the accounts rather than an account id because the dialog is "all
 * accounts" by design — the card is a column, not a filter. An account that no
 * longer exists leaves the name blank rather than dropping the row: the money
 * was still spent, and hiding it would make the total disagree with the list.
 */
export function buildExpensesOnDateView(
  transactions: readonly ExpenseTransaction[],
  accounts: readonly CreditCardAccount[],
  window: ExpenseDateWindow,
): ExpensesOnDateView {
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));

  const rows: DayExpenseRow[] = transactionsInDateWindow(transactions, window)
    .map((transaction) => ({
      id: transaction.id,
      date: transaction.transactionDate,
      // The raw text when post-import processing hasn't named a vendor yet —
      // an empty cell would read as "we don't know who", when the statement
      // line on the next line says exactly who.
      vendor: transaction.vendor !== "" ? transaction.vendor : transaction.transactionDescription,
      description: transaction.transactionDescription,
      categoryName: transaction.categoryName,
      accountName: accountNames.get(transaction.transactionAccountId) ?? "",
      amountCents: transaction.amountCents,
    }))
    // Oldest first, then biggest charge, then id. The date is the primary sort
    // because a ±N window spans several days and the reader is walking a
    // timeline; `id` breaks the remaining ties so the order is stable across
    // reads rather than depending on the repository's row order.
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        right.amountCents - left.amountCents ||
        left.id - right.id,
    );

  return {
    window,
    rows,
    totalCents: rows.reduce((sum, row) => sum + row.amountCents, 0),
  };
}
