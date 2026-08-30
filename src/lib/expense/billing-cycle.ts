// Billing-cycle arithmetic: which statement period a dated transaction falls in.
//
// A card's `statementCloseDay` is the day of the month the statement closes, and
// that day is *on* the statement. So a card closing on the 28th has cycles
// running 29 Jul – 28 Aug, 29 Aug – 28 Sep, and so on: a purchase on the 28th
// belongs to the cycle ending that day, and one on the 29th opens the next.
//
// Nothing here touches a Date object. Dates in this app are YYYY-MM-DD strings
// (see `ExpenseTransaction.transactionDate`), and routing them through
// `new Date(...)` would reinterpret them in the runtime's timezone — a purchase
// on the 1st becoming the previous month's on a machine behind UTC. The
// arithmetic is done on the parts instead, which is also why it's exact.

/** Days in a month, 1-indexed by month. February is resolved per-year. */
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * The day a statement closes when a card hasn't been told otherwise. Most cards
 * close near the end of the month, so this is a useful guess rather than a
 * neutral one — a card imported before anyone visits Meta Data still groups into
 * plausible cycles instead of a single undifferentiated pile.
 */
export const DEFAULT_STATEMENT_CLOSE_DAY = 28;

/** The lowest and highest close day a card may carry. */
export const MIN_STATEMENT_CLOSE_DAY = 1;
export const MAX_STATEMENT_CLOSE_DAY = 31;

/** One statement period: both bounds inclusive, both YYYY-MM-DD. */
export interface BillingCycle {
  /** First day on the statement. */
  startDate: string;
  /** Last day on the statement — the close day itself. */
  endDate: string;
  /**
   * Sort key and identity: the close date, so cycles order chronologically as
   * plain strings and two transactions in one period share a key exactly.
   */
  key: string;
  /** Human label, e.g. "29 Jul – 28 Aug 2026". */
  label: string;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month];
}

/**
 * Parses YYYY-MM-DD into parts, or undefined when the string isn't one. Callers
 * get a value rather than an exception because the input is statement data: a
 * blank or malformed date is a row to set aside, not a crash.
 */
function parseIsoDate(iso: string): { year: number; month: number; day: number } | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return undefined;
  if (day < 1 || day > daysInMonth(year, month)) return undefined;
  return { year, month, day };
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The close day clamped to a month that's shorter than it. A card closing on the
 * 31st closes on the 28th in February — there is no 31st to close on, and every
 * card issuer resolves it the same way, by the last day of the month.
 */
function closeDayIn(year: number, month: number, closeDay: number): number {
  return Math.min(closeDay, daysInMonth(year, month));
}

/** Steps a (year, month) pair back one month, rolling the year over. */
function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** Steps a (year, month) pair on one month, rolling the year over. */
function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/**
 * Normalises a stored close day. Anything outside 1–31 — including the 0 that
 * rows predating migration 0070 could carry — falls back to the default rather
 * than throwing, so one bad account row can't blank the whole grouped view.
 */
export function normalizeCloseDay(closeDay: number): number {
  if (!Number.isInteger(closeDay)) return DEFAULT_STATEMENT_CLOSE_DAY;
  if (closeDay < MIN_STATEMENT_CLOSE_DAY || closeDay > MAX_STATEMENT_CLOSE_DAY) {
    return DEFAULT_STATEMENT_CLOSE_DAY;
  }
  return closeDay;
}

/**
 * The billing cycle a date falls in, for a card closing on `closeDay`.
 *
 * Returns undefined only when `date` isn't a YYYY-MM-DD date — an invalid
 * `closeDay` is normalised rather than rejected, since the card is the app's own
 * data while the date may have come from a statement.
 */
export function cycleForDate(date: string, closeDay: number): BillingCycle | undefined {
  const parsed = parseIsoDate(date);
  if (!parsed) return undefined;

  const day = normalizeCloseDay(closeDay);

  // Which month's close date this transaction is on or before. On the close day
  // itself it's this month's — the close day is on the statement.
  const closesThisMonth = parsed.day <= closeDayIn(parsed.year, parsed.month, day);
  const end = closesThisMonth
    ? { year: parsed.year, month: parsed.month }
    : nextMonth(parsed.year, parsed.month);

  const endDay = closeDayIn(end.year, end.month, day);
  const endDate = formatIsoDate(end.year, end.month, endDay);

  // The cycle opens the day after the previous close. Computed from the previous
  // month's own clamped close day rather than by subtracting from `endDate`, so a
  // 31st-of-the-month card gets 1 Mar (not 29 Feb) after a February close.
  const previous = previousMonth(end.year, end.month);
  const previousCloseDay = closeDayIn(previous.year, previous.month, day);
  const startFromPrevious =
    previousCloseDay + 1 > daysInMonth(previous.year, previous.month)
      ? { ...end, day: 1 }
      : { ...previous, day: previousCloseDay + 1 };
  const startDate = formatIsoDate(
    startFromPrevious.year,
    startFromPrevious.month,
    startFromPrevious.day,
  );

  return { startDate, endDate, key: endDate, label: cycleLabel(startDate, endDate) };
}

/**
 * "29 Jul – 28 Aug 2026", or "29 Dec 2025 – 28 Jan 2026" when the period spans a
 * new year. The year is printed once where it's unambiguous, because a column of
 * cycle labels is read by its day-and-month and the repeated year is noise.
 */
export function cycleLabel(startDate: string, endDate: string): string {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (!start || !end) return `${startDate} – ${endDate}`;

  const startText = `${start.day} ${MONTH_NAMES[start.month - 1]}`;
  const endText = `${end.day} ${MONTH_NAMES[end.month - 1]} ${end.year}`;
  return start.year === end.year
    ? `${startText} – ${endText}`
    : `${startText} ${start.year} – ${endText}`;
}
