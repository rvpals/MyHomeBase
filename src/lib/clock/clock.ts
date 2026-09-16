// Pure — no I/O. The ISO-8601 week number, and the date parts the clock draws.
//
// Local-calendar throughout, via `parseIsoDateLocal` — the same clock the rest of this
// app files a day under. A UTC week number would flip a Sunday evening into next week
// in a negative-offset timezone, which is the whole class of bug `shared/date.ts`
// exists to avoid.

import { parseIsoDateLocal, toIsoDateLocal } from "@/lib/shared/date";
import type { ClockReading } from "./types";

const DAY_MS = 86_400_000;

/**
 * The Thursday of the ISO week containing `date`.
 *
 * Thursday is the load-bearing trick in every correct ISO week implementation, and it
 * is worth stating why rather than leaving it as a magic offset. ISO-8601 defines week
 * 1 as the week containing the year's first Thursday — equivalently, the week
 * containing 4 January, equivalently the week whose *majority* of days fall in that
 * year. So a week's Thursday is the single day that always lies in the week's own ISO
 * year, whichever calendar year the Monday and the Sunday happen to land in.
 *
 * Once you have the Thursday, both answers fall out with no special cases: the ISO year
 * is that Thursday's calendar year, and the week number is how many weeks it sits after
 * the first Thursday of that year. No leap-year branch, no 52-vs-53 table.
 */
function isoWeekThursday(date: Date): Date {
  // getDay(): 0 = Sunday. ISO counts Monday as day 1, so Sunday is day 7 and belongs
  // to the week that began six days earlier — not the one starting tomorrow.
  const isoWeekday = date.getDay() === 0 ? 7 : date.getDay();
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  thursday.setDate(thursday.getDate() + (4 - isoWeekday));
  return thursday;
}

/**
 * The ISO-8601 week-of-year for a "YYYY-MM-DD" date, 1-53.
 *
 * The cases that break a naive `Math.ceil(dayOfYear / 7)`, all of which are pinned in
 * the test: 2026-01-01 is a Thursday and so is week 1, while 2027-01-01 is a Friday and
 * belongs to **week 53 of 2026**; 2024-12-30 is a Monday already in **week 1 of 2025**.
 *
 * Throws on a malformed or impossible date, via `parseIsoDateLocal`.
 */
export function isoWeekNumber(isoDate: string): number {
  const thursday = isoWeekThursday(parseIsoDateLocal(isoDate));

  // The first Thursday of the ISO year is, by definition, in week 1. Every later
  // Thursday is exactly a whole number of weeks after it.
  const firstThursday = isoWeekThursday(new Date(thursday.getFullYear(), 0, 4));

  // Both are local midnight on a Thursday, so this gap is a whole number of weeks
  // except across a DST boundary, where one day runs 23 or 25 hours — hence the round.
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
}

/**
 * The year an ISO week belongs to, which differs from the calendar year in the few days
 * either side of New Year: 2027-01-01 reports 2026, because it falls in 2026's week 53.
 *
 * Throws on a malformed or impossible date.
 */
export function isoWeekYear(isoDate: string): number {
  return isoWeekThursday(parseIsoDateLocal(isoDate)).getFullYear();
}

/**
 * Everything the clock needs about a day, in one pass.
 *
 * `Intl.DateTimeFormat` rather than a hand-rolled month table: it is built into Node and
 * every browser, so the alternative would be shipping a names array to save nothing. The
 * locale is pinned to `en-GB` rather than left to the host's default, because the host
 * here is a NAS whose locale nobody has deliberately set — an unpinned default would let
 * the card silently render US order on one machine and day-first on another. Day-first
 * to match how dates read elsewhere in this app.
 *
 * **No time field.** The time belongs to the reader's own clock and ticks every second;
 * baking a server timestamp in here would render a time that is wrong by the network
 * round-trip and then frozen. The time is rendered client-side — see `ClockFace`.
 *
 * `now` is a parameter so callers and tests are not at the mercy of the clock.
 */
export function describeClock(now: Date = new Date()): ClockReading {
  const isoDate = toIsoDateLocal(now);

  return {
    isoDate,
    weekday: new Intl.DateTimeFormat("en-GB", { weekday: "long" }).format(now),
    longDate: new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(now),
    weekNumber: isoWeekNumber(isoDate),
    weekYear: isoWeekYear(isoDate),
  };
}
