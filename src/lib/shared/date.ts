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
