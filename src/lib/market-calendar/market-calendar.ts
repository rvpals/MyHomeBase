// Is the US equity market open on a given calendar day?
//
// Pure, and deliberately *computed* rather than listed. A hard-coded table of
// holiday dates is correct until the year it runs out, and the failure is
// silent: the job simply starts refreshing on Thanksgiving again and nothing
// says so. Every NYSE closure follows a rule -- an nth weekday of a month, a
// fixed date rolled off the weekend, or Good Friday -- so the rules are what
// this file stores. It is right in 2030 without anyone touching it.
//
// Scope is the full-day closures only; see MARKET_CLOSURES for why the three
// early-close days are deliberately absent.
//
// Dates are "YYYY-MM-DD" strings throughout, and the UTC-based Date arithmetic
// below is an implementation detail: a date-only value has no timezone, and
// building it at UTC midnight is what keeps `getUTCDay()` from drifting across
// a day boundary in a negative-offset server. Callers hand in a date already
// resolved in the market's own zone -- see `MARKET_TIME_ZONE`.

import { MARKET_CLOSURE_LABELS, type MarketClosure } from "./types";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses "YYYY-MM-DD" to a UTC-midnight Date. Throws on anything else. */
function parseIsoUtc(isoDate: string): Date {
  const match = ISO_DATE.exec(isoDate.trim());
  if (!match) throw new Error(`Expected a YYYY-MM-DD date, got "${isoDate}".`);

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  // Rejects a well-formed but impossible date like 2026-02-31, which Date.UTC
  // would silently roll forward into March.
  if (toIsoUtc(date) !== isoDate.trim()) throw new Error(`"${isoDate}" is not a real date.`);
  return date;
}

function toIsoUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/**
 * The nth given weekday of a month — "the third Monday in January".
 *
 * `weekday` is a `getUTCDay()` number (0 = Sunday). `nth` counts from 1.
 */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): Date {
  const first = utc(year, month, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return addDays(first, offset + (nth - 1) * 7);
}

/** The last given weekday of a month — "the last Monday in May". */
function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  // Day 0 of the following month is the last day of this one.
  const last = new Date(Date.UTC(year, month, 0));
  return addDays(last, -((last.getUTCDay() - weekday + 7) % 7));
}

/**
 * Easter Sunday, by the Anonymous Gregorian computus.
 *
 * Needed only for Good Friday, which is the one NYSE closure with no fixed date
 * and no weekday rule. The algorithm is the standard one and is not worth
 * paraphrasing in comments; what matters is that it is exact for every
 * Gregorian year, which is why there is no table here either.
 */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

/**
 * The NYSE weekend-observance rule for a *fixed-date* holiday.
 *
 * A holiday falling on a Saturday is observed the preceding Friday; one falling
 * on a Sunday is observed the following Monday. The one documented exception is
 * that New Year's Day on a Saturday is **not** observed on 31 December — the
 * market simply stays open on that Friday — so this returns `undefined` there
 * and the caller drops the holiday for that year.
 */
function observed(date: Date, options: { rollBackFromSaturday: boolean }): Date | undefined {
  const weekday = date.getUTCDay();
  if (weekday === 6) return options.rollBackFromSaturday ? addDays(date, -1) : undefined;
  if (weekday === 0) return addDays(date, 1);
  return date;
}

/**
 * Every full-closure holiday in a year, as a date → closure map.
 *
 * Built per year and not cached: it is a dozen date computations, called once
 * per scheduler tick at most, and a cache keyed by year is more code than the
 * thing it would save.
 */
function holidaysForYear(year: number): Map<string, MarketClosure> {
  const holidays = new Map<string, MarketClosure>();

  const add = (date: Date | undefined, closure: MarketClosure) => {
    // A holiday rolled onto a weekend date it is not observed on contributes
    // nothing; the weekend check already covers that day.
    if (date) holidays.set(toIsoUtc(date), closure);
  };

  // Fixed dates, subject to the weekend-observance rule above.
  add(observed(utc(year, 1, 1), { rollBackFromSaturday: false }), "new-years-day");
  add(observed(utc(year, 6, 19), { rollBackFromSaturday: true }), "juneteenth");
  add(observed(utc(year, 7, 4), { rollBackFromSaturday: true }), "independence-day");
  add(observed(utc(year, 12, 25), { rollBackFromSaturday: true }), "christmas");

  // Weekday rules — these can never land on a weekend, so no observance rule.
  add(nthWeekdayOfMonth(year, 1, 1, 3), "martin-luther-king-jr-day");
  add(nthWeekdayOfMonth(year, 2, 1, 3), "washingtons-birthday");
  add(lastWeekdayOfMonth(year, 5, 1), "memorial-day");
  add(nthWeekdayOfMonth(year, 9, 1, 1), "labor-day");
  add(nthWeekdayOfMonth(year, 11, 4, 4), "thanksgiving");

  // The movable one.
  add(addDays(easterSunday(year), -2), "good-friday");

  return holidays;
}

/** True for a Saturday or Sunday. */
export function isWeekend(isoDate: string): boolean {
  const weekday = parseIsoUtc(isoDate).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/**
 * Why the market is closed on `isoDate`, or `undefined` if it is a trading day.
 *
 * The weekend is checked first so a holiday observed on a Saturday — which the
 * market does not observe at all — never reports as that holiday.
 */
export function marketClosure(isoDate: string): MarketClosure | undefined {
  if (isWeekend(isoDate)) return "weekend";
  const date = parseIsoUtc(isoDate);
  return holidaysForYear(date.getUTCFullYear()).get(toIsoUtc(date));
}

/** True when `isoDate` is a holiday the market observes (never a weekend). */
export function isMarketHoliday(isoDate: string): boolean {
  const closure = marketClosure(isoDate);
  return closure !== undefined && closure !== "weekend";
}

/** True when US equities trade on `isoDate`. */
export function isMarketDay(isoDate: string): boolean {
  return marketClosure(isoDate) === undefined;
}

/**
 * The next trading day strictly after `isoDate`.
 *
 * Walks forward a day at a time. The longest run of closed days the rules can
 * produce is four (a Thursday holiday is never followed by a closed Friday, but
 * Christmas on a Friday gives Fri–Sun plus the New Year's stretch in some
 * years), so the bound below is generous rather than tight — it exists only to
 * guarantee termination if a future rule change made the calendar pathological.
 */
export function nextMarketDay(isoDate: string): string {
  let candidate = addDays(parseIsoUtc(isoDate), 1);
  for (let guard = 0; guard < 10; guard += 1) {
    const iso = toIsoUtc(candidate);
    if (isMarketDay(iso)) return iso;
    candidate = addDays(candidate, 1);
  }
  // Unreachable with the rules above; returning the candidate beats throwing
  // inside a background tick.
  return toIsoUtc(candidate);
}

/**
 * Why the market is shut, as a phrase for a sentence — "the weekend",
 * "Thanksgiving Day". `undefined` on a trading day.
 */
export function describeMarketClosure(isoDate: string): string | undefined {
  const closure = marketClosure(isoDate);
  return closure === undefined ? undefined : MARKET_CLOSURE_LABELS[closure];
}
