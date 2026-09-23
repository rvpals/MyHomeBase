import { isoWeekNumber, isoWeekYear } from "@/lib/clock";
import { parseIsoDateLocal, startOfWeekIso, toIsoDateLocal } from "@/lib/shared/date";
import type { SiteVisit, VisitDayGroup, VisitWeekGroup } from "./types";

/**
 * Buckets arrivals into weeks, and each week into days.
 *
 * Lives here rather than in the view for the reason ARCHITECTURE.md gives: this is
 * arithmetic over data, so it is a tested function that takes rows and returns rows.
 * The Visit tab renders the result and owns no date logic at all — including the two
 * labels, which are built here so there is one place where a week is named.
 *
 * Week boundaries come from `startOfWeekIso` (Monday) and the ISO week number from
 * `isoWeekNumber` / `isoWeekYear`, all of which are already tested — notably across
 * DST and the New Year boundary, where 2027-01-01 belongs to week 53 of 2026. None of
 * that is re-derived here.
 *
 * Both levels are newest-first, matching the rest of the screen, and so are the
 * visits inside each day.
 *
 * A row whose `createdAt` is not a parseable timestamp is skipped rather than thrown
 * on. This is an audit log rendered on an admin screen: one malformed row must not
 * blank the whole page, and the row is still reachable in the flat list.
 */
export function groupVisitsByWeekAndDay(visits: readonly SiteVisit[]): VisitWeekGroup[] {
  const byDate = new Map<string, SiteVisit[]>();

  for (const visit of visits) {
    const date = localDateOf(visit.createdAt);
    if (date === undefined) continue;

    const bucket = byDate.get(date);
    if (bucket === undefined) byDate.set(date, [visit]);
    else bucket.push(visit);
  }

  const byWeek = new Map<string, VisitDayGroup[]>();

  for (const [date, dayVisits] of byDate) {
    dayVisits.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const day: VisitDayGroup = {
      date,
      label: formatDayLabel(date),
      visits: dayVisits,
      totalVisits: dayVisits.length,
      uniqueIps: countUniqueIps(dayVisits),
      suspiciousVisits: dayVisits.filter((visit) => visit.suspicion === "suspicious").length,
    };

    const weekStart = startOfWeekIso(date);
    const bucket = byWeek.get(weekStart);
    if (bucket === undefined) byWeek.set(weekStart, [day]);
    else bucket.push(day);
  }

  const weeks: VisitWeekGroup[] = [];

  for (const [weekStart, days] of byWeek) {
    days.sort((a, b) => b.date.localeCompare(a.date));

    // Counted from the week's own visits, not by summing the days: unique IPs do not
    // add up across days, because one address arriving on three days is one address.
    const weekVisits = days.flatMap((day) => day.visits);

    weeks.push({
      isoYear: isoWeekYear(weekStart),
      isoWeek: isoWeekNumber(weekStart),
      weekStart,
      label: formatWeekLabel(weekStart),
      days,
      totalVisits: weekVisits.length,
      uniqueIps: countUniqueIps(weekVisits),
      suspiciousVisits: weekVisits.filter((visit) => visit.suspicion === "suspicious").length,
    });
  }

  weeks.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  return weeks;
}

/**
 * The local calendar date of a stored timestamp, or `undefined` if unparseable.
 *
 * Stored timestamps are SQLite's `datetime('now')` — `YYYY-MM-DD HH:MM:SS` in **UTC**.
 * The space is replaced and a `Z` appended so it parses as the UTC instant it is,
 * which is the whole point: a visit at 23:30 UTC belongs to the next local day in a
 * positive-offset timezone, and bucketing on the raw string prefix would file it
 * under the wrong day. One clock for the date, the reader's — the same rule
 * `toLocalTimeLabel` documents in shared/date.ts.
 */
function localDateOf(createdAt: string): string | undefined {
  const normalised = createdAt.trim().replace(" ", "T");
  const withZone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(normalised) ? normalised : `${normalised}Z`;

  const instant = new Date(withZone);
  if (Number.isNaN(instant.getTime())) return undefined;
  return toIsoDateLocal(instant);
}

function countUniqueIps(visits: readonly SiteVisit[]): number {
  const addresses = new Set<string>();
  for (const visit of visits) {
    // Blank addresses collapse into one "unknown" bucket rather than counting as a
    // distinct address each — several unattributable visits are not several visitors.
    addresses.add(visit.ipAddress ?? "");
  }
  return addresses.size;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Sat Sep 19". */
export function formatDayLabel(isoDate: string): string {
  const date = parseIsoDateLocal(isoDate);
  return `${WEEKDAY_NAMES[date.getDay()]} ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
}

/**
 * "Week 38 · Sep 14–20", or "Week 40 · Sep 28 – Oct 4" when the week spans a month.
 *
 * The month is repeated only when it changes, because "Sep 14 – Sep 20" reads as two
 * separate dates where "Sep 14–20" reads as one span.
 */
export function formatWeekLabel(weekStart: string): string {
  const start = parseIsoDateLocal(weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);

  const week = isoWeekNumber(weekStart);
  const startMonth = MONTH_NAMES[start.getMonth()];
  const endMonth = MONTH_NAMES[end.getMonth()];

  const span =
    startMonth === endMonth
      ? `${startMonth} ${start.getDate()}–${end.getDate()}`
      : `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}`;

  return `Week ${week} · ${span}`;
}
