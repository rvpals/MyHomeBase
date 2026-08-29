// Pure — no I/O. Local-calendar date helpers shared by any domain that keys data
// by "the day it happened" rather than by an instant.
//
// Everything here works in the server's LOCAL timezone and returns "YYYY-MM-DD".
// Deliberately not `toISOString().slice(0, 10)`, which shifts to UTC and picks
// tomorrow's date for part of every evening in a negative-offset timezone — that
// would file an evening snapshot under the wrong trading day.

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** A Date as a local-calendar "YYYY-MM-DD". */
export function toIsoDateLocal(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * An instant formatted the way SQLite's `datetime('now')` does — `YYYY-MM-DD HH:MM:SS`
 * in **UTC**, space-separated.
 *
 * Use this for any value compared against, or stored alongside, a column defaulting to
 * `datetime('now')`. Those comparisons are *string* comparisons, and
 * `toISOString()` would produce `2026-08-16T14:30:00.000Z`, whose "T" sorts after the
 * space in every stored value — so an ISO cutoff silently matches rows it shouldn't.
 *
 * UTC, unlike the local-calendar helpers above, because that is what SQLite writes.
 */
export function toSqliteTimestampUtc(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

/** Today, local-calendar. `now` is injectable so tests don't depend on the clock. */
export function todayIsoLocal(now: Date = new Date()): string {
  return toIsoDateLocal(now);
}

/** Parses "YYYY-MM-DD" as a local-midnight Date. Throws on anything else. */
export function parseIsoDateLocal(isoDate: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) throw new Error(`Expected a YYYY-MM-DD date, got "${isoDate}".`);

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  // Rejects a well-formed but impossible date like 2026-02-31, which the Date
  // constructor would silently roll forward to March.
  if (toIsoDateLocal(date) !== isoDate.trim()) throw new Error(`"${isoDate}" is not a real date.`);
  return date;
}

/**
 * The Monday of the week containing `isoDate`. Monday rather than Sunday because
 * a trading week is Monday-to-Friday — a Sunday-start week would split Friday's
 * session from the four days it belongs with.
 */
export function startOfWeekIso(isoDate: string): string {
  const date = parseIsoDateLocal(isoDate);
  // getDay(): 0 = Sunday. Sunday belongs to the week that started 6 days earlier.
  const daysSinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysSinceMonday);
  return toIsoDateLocal(date);
}

/** The first day of the month containing `isoDate`. */
export function startOfMonthIso(isoDate: string): string {
  const date = parseIsoDateLocal(isoDate);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`;
}

/** The first day of the year containing `isoDate`. */
export function startOfYearIso(isoDate: string): string {
  return `${parseIsoDateLocal(isoDate).getFullYear()}-01-01`;
}

/**
 * A span expressed the way a person counts one: whole years, then whole months, then
 * leftover days.
 *
 * All three are non-negative. A future date yields all zeros rather than negatives —
 * see `calendarAgeSince`.
 */
export interface CalendarAge {
  years: number;
  months: number;
  days: number;
}

/**
 * How long ago `isoDate` was, in calendar years, months and days.
 *
 * Calendar arithmetic, not division. `days / 365` would call a photo taken on
 * 2019-06-09 and viewed on 2025-06-09 "5 years, 11 months" because of the leap days in
 * between, when the answer a reader wants is "6 years". So the units are subtracted
 * field by field and borrowed when negative — days from the length of the month
 * preceding `now`, months from a year — which is what makes an exact anniversary come
 * out as a clean `{ years: n, months: 0, days: 0 }`.
 *
 * The months are counted by walking `isoDate` forward a month at a time and measuring
 * what is left, rather than by subtracting the day-of-month fields and borrowing. A
 * borrow has to pick *some* month to borrow from, and every choice is wrong somewhere:
 * borrowing from the month before `now` turns 2026-01-31 -> 2026-03-01 into "1 month,
 * -2 days" (February's 28 can't cover a 30-day deficit), and borrowing from the month
 * `isoDate` falls in overstates every ordinary mid-month span. Walking sidesteps the
 * choice — the leftover is a real count of days between two real dates, so it can
 * never come out negative.
 *
 * The one subtlety is what "one month after the 31st" means when the target month is
 * shorter. It clamps to the last day of that month, so 2026-01-31 + 1 month is 28 Feb
 * and the span to 2026-03-01 reads "1 month, 1 day" — the answer a person gives. The
 * clamp is also what keeps an exact anniversary at `{ years: n, months: 0, days: 0 }`.
 *
 * A date in the future returns all zeros. A camera with a wrong clock, or a photo
 * copied with a stamp from next week, is not worth a "-3 days" in a card title, and
 * the caller cannot do anything more useful with a negative span than treat it as now.
 *
 * `now` is a parameter so callers and tests are not at the mercy of the clock.
 */
export function calendarAgeSince(isoDate: string, now: Date = new Date()): CalendarAge {
  const then = parseIsoDateLocal(isoDate);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (then.getTime() >= today.getTime()) return { years: 0, months: 0, days: 0 };

  /**
   * `then` advanced by `count` whole months, clamped to the last day of the target
   * month. Day 0 of the following month is that month's last day, which is where the
   * 28/29/30/31 comes from — no leap-year special case anywhere in this file.
   */
  const monthsAfterThen = (count: number): Date => {
    const lastDayOfTarget = new Date(then.getFullYear(), then.getMonth() + count + 1, 0).getDate();
    return new Date(
      then.getFullYear(),
      then.getMonth() + count,
      Math.min(then.getDate(), lastDayOfTarget),
    );
  };

  // The month gap by field, then one step back if that lands past `now` — which it
  // does whenever the day-of-month hasn't come round yet.
  let months =
    (today.getFullYear() - then.getFullYear()) * 12 + (today.getMonth() - then.getMonth());
  if (monthsAfterThen(months).getTime() > today.getTime()) months -= 1;

  // Both are local midnight, so this division is exact except across a DST boundary,
  // where one of the days is 23 or 25 hours long — hence the rounding.
  const days = Math.round((today.getTime() - monthsAfterThen(months).getTime()) / 86_400_000);

  return { years: Math.floor(months / 12), months: months % 12, days };
}

/** `1 day` / `2 days`, and the same for the other two units. */
function unit(value: number, name: string): string {
  return `${value} ${name}${value === 1 ? "" : "s"}`;
}

/**
 * A `CalendarAge` as English: `"6 years, 2 months, 20 days ago"`.
 *
 * Zero units are dropped, so an exact anniversary reads `"6 years ago"` rather than
 * `"6 years, 0 months, 0 days ago"`, and a photo from last week reads `"3 days ago"`
 * with no leading zeros to wade through. An all-zero span — today, or a future date
 * `calendarAgeSince` clamped — is `"today"`, since "0 days ago" is a strange way to
 * say it.
 *
 * Middle zeros are dropped too: `{ years: 2, months: 0, days: 5 }` is "2 years,
 * 5 days ago". Keeping the "0 months" would be more literal and reads worse.
 */
export function formatCalendarAge(age: CalendarAge): string {
  const parts: string[] = [];
  if (age.years > 0) parts.push(unit(age.years, "year"));
  if (age.months > 0) parts.push(unit(age.months, "month"));
  if (age.days > 0) parts.push(unit(age.days, "day"));

  if (parts.length === 0) return "today";
  return `${parts.join(", ")} ago`;
}
