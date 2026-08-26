// The Calendar screen's whole shape, as pure functions over ISO date strings.
//
// Everything here takes data and returns data: no clock, no I/O, no React. The
// view maps over the returned arrays and does no date arithmetic of its own —
// which is what lets `journal-calendar` print the same grid in a terminal. If
// you find yourself computing a weekday or a month length in a .tsx, it belongs
// in this file instead.
//
// Dates are "YYYY-MM-DD" strings throughout, never `Date` objects, and the
// arithmetic is done in UTC. That's deliberate: a journal entry's date is a
// calendar day the writer chose, not an instant, so constructing a local-time
// Date from it would shift the day for anyone west of UTC and put an entry in
// the wrong cell. `Date.UTC` in, `toISOString().slice(0, 10)` out.

/** Which of the three grids the screen is showing. */
export type JournalCalendarScope = "month" | "week" | "year";

export const JOURNAL_CALENDAR_SCOPES: readonly JournalCalendarScope[] = [
  "month",
  "week",
  "year",
] as const;

export function isJournalCalendarScope(value: string): value is JournalCalendarScope {
  return (JOURNAL_CALENDAR_SCOPES as readonly string[]).includes(value);
}

/**
 * The date formats the Jump control can read. A typed date is ambiguous without
 * one of these — 01/02/2026 is January 2nd or February 1st depending on the
 * reader — so the format is an explicit choice rather than a guess.
 */
export type JournalDateFormat = "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";

export const JOURNAL_DATE_FORMATS: readonly JournalDateFormat[] = [
  "MM/DD/YYYY",
  "DD/MM/YYYY",
  "YYYY-MM-DD",
] as const;

export const DEFAULT_JOURNAL_DATE_FORMAT: JournalDateFormat = "MM/DD/YYYY";

export function isJournalDateFormat(value: string): value is JournalDateFormat {
  return (JOURNAL_DATE_FORMATS as readonly string[]).includes(value);
}

/** How many characters of an entry title a day cell shows before eliding. */
export const CALENDAR_TITLE_MAX_LENGTH = 30;

/** How many titles a day cell lists before collapsing the rest into "+N more". */
export const CALENDAR_CELL_TITLE_LIMIT = 3;

/** Same, below 1024px, where a cell has room for one line. */
export const CALENDAR_CELL_TITLE_LIMIT_COMPACT = 1;

/**
 * One entry as a calendar cell shows it: the elided label for the cell, and the
 * full title for the tooltip. Carries the id so a click can open the viewer.
 */
export interface CalendarEntryLabel {
  id: number;
  /** "HH:MM", or "" when the entry has no time. */
  time: string;
  /** The full title, for the hover hint. May be "". */
  title: string;
  /** The first CALENDAR_TITLE_MAX_LENGTH characters, with an ellipsis if cut. */
  shortTitle: string;
  /** Whether shortTitle is actually shorter than title — the view uses this to
   *  decide whether a tooltip adds anything. */
  isTruncated: boolean;
}

/** One day cell in any of the three grids. */
export interface CalendarDay {
  /** "YYYY-MM-DD". */
  date: string;
  /** 1–31, for the number drawn in the corner. */
  dayOfMonth: number;
  /** 0 (Sunday) – 6 (Saturday). */
  dayOfWeek: number;
  /**
   * False for the leading/trailing days a month grid borrows from its
   * neighbours, so the view can dim them. Always true in a week grid.
   */
  isCurrentPeriod: boolean;
  isToday: boolean;
  isSelected: boolean;
  /** This day's entries, earliest time first. */
  entries: CalendarEntryLabel[];
}

/** A week row: exactly seven days, Sunday first. */
export interface CalendarWeek {
  /** The row's first date, for a stable React key. */
  startDate: string;
  days: CalendarDay[];
}

/** One month of weeks — the month grid, and each tile of the year grid. */
export interface CalendarMonth {
  /** 1–12. */
  month: number;
  year: number;
  /** "January", … — English, matching the rest of the app's labels. */
  label: string;
  weeks: CalendarWeek[];
  /** Entries dated inside this month, ignoring the borrowed padding days. */
  entryCount: number;
}

/** What the Month and Week scopes render. */
export interface CalendarGrid {
  scope: "month" | "week";
  /** The anchor's own month/year, for the heading. */
  title: string;
  weeks: CalendarWeek[];
  /** Entries inside the period proper, excluding padding days. */
  entryCount: number;
}

/** What the Year scope renders. */
export interface CalendarYearGrid {
  scope: "year";
  year: number;
  title: string;
  months: CalendarMonth[];
  entryCount: number;
  /** The busiest single day in the year, so the heat shading has a top end. */
  maxDayEntryCount: number;
}

/** The inclusive date window a scope needs read from the repository. */
export interface CalendarRange {
  /** "YYYY-MM-DD", inclusive. */
  start: string;
  /** "YYYY-MM-DD", inclusive. */
  end: string;
}

/** The minimum an entry has to carry to be placed on the calendar. */
export interface CalendarEntryLike {
  id: number;
  date: string;
  time: string;
  title: string;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Sunday-first, matching the grids. Exported so the view needn't retype them. */
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const DAYS_IN_WEEK = 7;
/** A month grid is always 6 rows, so switching months never reflows the page. */
const WEEKS_IN_MONTH_GRID = 6;
const MS_PER_DAY = 86_400_000;

/** Splits an ISO date, throwing on anything that isn't one. */
function parseIsoParts(date: string, label: string): { year: number; month: number; day: number } {
  const match = ISO_DATE.exec(date);
  if (!match) throw new Error(`${label}: expected a YYYY-MM-DD date, got "${date}".`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // A well-formed string can still name a day that doesn't exist (2026-02-30).
  // Round-tripping through Date.UTC catches that: JS rolls the overflow forward,
  // so the formatted result won't match what came in.
  if (toIsoDate(year, month, day) !== date) {
    throw new Error(`${label}: "${date}" is not a real calendar date.`);
  }
  return { year, month, day };
}

/** Builds an ISO date, normalizing overflow (month 13 → next January). */
function toIsoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** `date` moved by `days`, which may be negative. */
function addDays(date: string, days: number): string {
  const { year, month, day } = parseIsoParts(date, "addDays");
  return new Date(Date.UTC(year, month - 1, day) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** 0 (Sunday) – 6 (Saturday). */
function dayOfWeek(date: string): number {
  const { year, month, day } = parseIsoParts(date, "dayOfWeek");
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The Sunday of `date`'s week — `date` itself when it is a Sunday. */
export function startOfWeek(date: string): string {
  return addDays(date, -dayOfWeek(date));
}

/** The 1st of `date`'s month. */
export function startOfMonth(date: string): string {
  const { year, month } = parseIsoParts(date, "startOfMonth");
  return toIsoDate(year, month, 1);
}

/** The last day of `date`'s month — day 0 of the next one. */
export function endOfMonth(date: string): string {
  const { year, month } = parseIsoParts(date, "endOfMonth");
  return toIsoDate(year, month + 1, 0);
}

/**
 * The inclusive range a scope has to read, including the days a month grid
 * borrows from its neighbours — those cells show titles too, so leaving them out
 * would make the same day look empty in one month and populated in the next.
 */
export function journalCalendarRange(scope: JournalCalendarScope, anchor: string): CalendarRange {
  parseIsoParts(anchor, "journalCalendarRange");

  if (scope === "week") {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, DAYS_IN_WEEK - 1) };
  }

  if (scope === "year") {
    const { year } = parseIsoParts(anchor, "journalCalendarRange");
    // A year's 12 grids pad into the previous December and the next January.
    const start = startOfWeek(toIsoDate(year, 1, 1));
    const lastMonthStart = startOfWeek(toIsoDate(year, 12, 1));
    return { start, end: addDays(lastMonthStart, WEEKS_IN_MONTH_GRID * DAYS_IN_WEEK - 1) };
  }

  const start = startOfWeek(startOfMonth(anchor));
  return { start, end: addDays(start, WEEKS_IN_MONTH_GRID * DAYS_IN_WEEK - 1) };
}

/**
 * An entry's cell label: the full title for the tooltip, and the first
 * CALENDAR_TITLE_MAX_LENGTH characters for the cell itself.
 *
 * The elision is on **character count, not word boundary** — the requirement is
 * "first 30 characters", and breaking on a word would make the cut length vary
 * per row, which reads as ragged in a narrow column. An untitled entry gets a
 * placeholder rather than an empty row you can't click with confidence.
 */
export function calendarEntryLabel(entry: CalendarEntryLike): CalendarEntryLabel {
  const title = entry.title.trim();
  const display = title === "" ? "(untitled)" : title;
  const isTruncated = display.length > CALENDAR_TITLE_MAX_LENGTH;
  return {
    id: entry.id,
    time: entry.time,
    title: display,
    // Slice to exactly 30 and append the ellipsis, so the label is 31 chars at
    // most and every truncated row cuts at the same column.
    shortTitle: isTruncated ? `${display.slice(0, CALENDAR_TITLE_MAX_LENGTH)}…` : display,
    isTruncated,
  };
}

/**
 * Entries bucketed by date, each bucket sorted earliest-time-first. Entries with
 * no time sort after timed ones — an untimed entry is "some time that day", so
 * putting it at 00:00 would claim it happened before breakfast.
 */
export function groupEntriesByDate(
  entries: readonly CalendarEntryLike[],
): Map<string, CalendarEntryLabel[]> {
  const byDate = new Map<string, CalendarEntryLike[]>();
  for (const entry of entries) {
    const bucket = byDate.get(entry.date);
    if (bucket) bucket.push(entry);
    else byDate.set(entry.date, [entry]);
  }

  const labelled = new Map<string, CalendarEntryLabel[]>();
  for (const [date, bucket] of byDate) {
    const sorted = [...bucket].sort((a, b) => {
      const aTime = a.time.trim();
      const bTime = b.time.trim();
      if (aTime === "" && bTime === "") return a.id - b.id;
      if (aTime === "") return 1;
      if (bTime === "") return -1;
      return aTime === bTime ? a.id - b.id : aTime.localeCompare(bTime);
    });
    labelled.set(date, sorted.map(calendarEntryLabel));
  }
  return labelled;
}

/** Shared cell builder for all three grids. */
function buildDay(
  date: string,
  options: {
    currentMonth?: number;
    today: string;
    selectedDate?: string;
    byDate: Map<string, CalendarEntryLabel[]>;
  },
): CalendarDay {
  const { month, day } = parseIsoParts(date, "buildDay");
  return {
    date,
    dayOfMonth: day,
    dayOfWeek: dayOfWeek(date),
    isCurrentPeriod: options.currentMonth === undefined || month === options.currentMonth,
    isToday: date === options.today,
    isSelected: options.selectedDate !== undefined && date === options.selectedDate,
    entries: options.byDate.get(date) ?? [],
  };
}

/** `count` week rows starting at `start`, which must be a Sunday. */
function buildWeeks(
  start: string,
  count: number,
  options: {
    currentMonth?: number;
    today: string;
    selectedDate?: string;
    byDate: Map<string, CalendarEntryLabel[]>;
  },
): CalendarWeek[] {
  const weeks: CalendarWeek[] = [];
  for (let week = 0; week < count; week += 1) {
    const weekStart = addDays(start, week * DAYS_IN_WEEK);
    const days: CalendarDay[] = [];
    for (let offset = 0; offset < DAYS_IN_WEEK; offset += 1) {
      days.push(buildDay(addDays(weekStart, offset), options));
    }
    weeks.push({ startDate: weekStart, days });
  }
  return weeks;
}

function countEntries(weeks: readonly CalendarWeek[]): number {
  let total = 0;
  for (const week of weeks) {
    for (const day of week.days) {
      // Padding days belong to the neighbouring month, so they don't count
      // toward "entries this month" even though they render their titles.
      if (day.isCurrentPeriod) total += day.entries.length;
    }
  }
  return total;
}

export interface BuildGridOptions {
  /** The anchor date — any day inside the period being shown. */
  anchor: string;
  /** Entries covering at least `journalCalendarRange(scope, anchor)`. */
  entries: readonly CalendarEntryLike[];
  /** Today, passed in rather than read from the clock so this stays testable. */
  today: string;
  /** The clicked day, if any. */
  selectedDate?: string;
}

/**
 * The month grid: always 6 rows of 7, Sunday first, padded with the neighbouring
 * months' days. Fixed height on purpose — a 5-row February next to a 6-row March
 * would shift everything below the calendar as you page through the year.
 */
export function buildMonthGrid({
  anchor,
  entries,
  today,
  selectedDate,
}: BuildGridOptions): CalendarGrid {
  const { year, month } = parseIsoParts(anchor, "buildMonthGrid");
  const byDate = groupEntriesByDate(entries);
  const weeks = buildWeeks(startOfWeek(startOfMonth(anchor)), WEEKS_IN_MONTH_GRID, {
    currentMonth: month,
    today,
    selectedDate,
    byDate,
  });
  return {
    scope: "month",
    title: `${MONTH_LABELS[month - 1]} ${year}`,
    weeks,
    entryCount: countEntries(weeks),
  };
}

/**
 * The week grid: the one Sunday-to-Saturday row containing the anchor. Every day
 * is "current", so nothing is dimmed.
 */
export function buildWeekGrid({
  anchor,
  entries,
  today,
  selectedDate,
}: BuildGridOptions): CalendarGrid {
  const byDate = groupEntriesByDate(entries);
  const start = startOfWeek(anchor);
  const weeks = buildWeeks(start, 1, { today, selectedDate, byDate });
  const end = addDays(start, DAYS_IN_WEEK - 1);
  const startParts = parseIsoParts(start, "buildWeekGrid");
  const endParts = parseIsoParts(end, "buildWeekGrid");
  // "Mar 29 – Apr 4, 2026" when the week straddles two months, and the shorter
  // "Apr 5 – 11, 2026" when it doesn't.
  const title =
    startParts.month === endParts.month
      ? `${MONTH_LABELS[startParts.month - 1]} ${startParts.day} – ${endParts.day}, ${endParts.year}`
      : `${MONTH_LABELS[startParts.month - 1].slice(0, 3)} ${startParts.day} – ` +
        `${MONTH_LABELS[endParts.month - 1].slice(0, 3)} ${endParts.day}, ${endParts.year}` +
        (startParts.year === endParts.year ? "" : ` (from ${startParts.year})`);
  return { scope: "week", title, weeks, entryCount: countEntries(weeks) };
}

/**
 * The year grid: 12 mini-months, each a full 6×7 grid so they tile evenly. Also
 * reports the busiest day's count, which is what the view shades against — a
 * fixed scale would wash out a quiet year and saturate a busy one.
 */
export function buildYearGrid({
  anchor,
  entries,
  today,
  selectedDate,
}: BuildGridOptions): CalendarYearGrid {
  const { year } = parseIsoParts(anchor, "buildYearGrid");
  const byDate = groupEntriesByDate(entries);

  const months: CalendarMonth[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const weeks = buildWeeks(startOfWeek(toIsoDate(year, month, 1)), WEEKS_IN_MONTH_GRID, {
      currentMonth: month,
      today,
      selectedDate,
      byDate,
    });
    months.push({
      month,
      year,
      label: MONTH_LABELS[month - 1],
      weeks,
      entryCount: countEntries(weeks),
    });
  }

  let maxDayEntryCount = 0;
  let entryCount = 0;
  for (const month of months) {
    entryCount += month.entryCount;
    for (const week of month.weeks) {
      for (const day of week.days) {
        if (day.isCurrentPeriod && day.entries.length > maxDayEntryCount) {
          maxDayEntryCount = day.entries.length;
        }
      }
    }
  }

  return { scope: "year", year, title: String(year), months, entryCount, maxDayEntryCount };
}

/**
 * The anchor moved `delta` periods, in the units of the current scope: months,
 * weeks, or years. `delta` 0 returns the anchor unchanged.
 *
 * Month and year steps clamp the day rather than rolling over — stepping from
 * Jan 31 lands on Feb 28, not Mar 3. Rolling over would let ‹ then › fail to
 * return you to where you started, which reads as the buttons being broken.
 */
export function shiftCalendarAnchor(
  scope: JournalCalendarScope,
  anchor: string,
  delta: number,
): string {
  const { year, month, day } = parseIsoParts(anchor, "shiftCalendarAnchor");
  if (!Number.isInteger(delta)) {
    throw new Error(`shiftCalendarAnchor: delta must be an integer, got ${delta}.`);
  }
  if (delta === 0) return anchor;

  if (scope === "week") return addDays(anchor, delta * DAYS_IN_WEEK);

  const targetMonth = scope === "year" ? month : month + delta;
  const targetYear = scope === "year" ? year + delta : year;
  // Day 0 of the following month is that month's last day — the clamp.
  const lastDay = Number(toIsoDate(targetYear, targetMonth + 1, 0).slice(8, 10));
  return toIsoDate(targetYear, targetMonth, Math.min(day, lastDay));
}

/** A parsed jump, or the reason the text couldn't be read. */
export type ParseJumpDateResult =
  | { ok: true; date: string }
  | { ok: false; error: string };

const FORMAT_PATTERNS: Record<JournalDateFormat, RegExp> = {
  "MM/DD/YYYY": /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/,
  "DD/MM/YYYY": /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/,
  "YYYY-MM-DD": /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/,
};

/**
 * Reads a typed date in the chosen format into an ISO date.
 *
 * The format is a parameter, not a guess: "01/02/2026" is a real date in two
 * formats and the reader is the only one who knows which was meant. Separators
 * are lenient (/, -, .) and single-digit months/days are accepted, because those
 * vary by habit and never change the meaning — but the *field order* never
 * budges from what was selected.
 *
 * Returns a result rather than throwing: a half-typed date is the normal state
 * of a text box, not an exception.
 */
export function parseJumpDate(
  text: string,
  format: JournalDateFormat = DEFAULT_JOURNAL_DATE_FORMAT,
): ParseJumpDateResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: "Enter a date." };

  const match = FORMAT_PATTERNS[format].exec(trimmed);
  if (!match) return { ok: false, error: `Enter the date as ${format}.` };

  const [year, month, day] =
    format === "YYYY-MM-DD"
      ? [Number(match[1]), Number(match[2]), Number(match[3])]
      : format === "DD/MM/YYYY"
        ? [Number(match[3]), Number(match[2]), Number(match[1])]
        : [Number(match[3]), Number(match[1]), Number(match[2])];

  if (month < 1 || month > 12) return { ok: false, error: `There is no month ${month}.` };
  if (day < 1 || day > 31) return { ok: false, error: `There is no day ${day}.` };

  const iso = toIsoDate(year, month, day);
  // Date.UTC rolls Feb 30 forward to Mar 2, so a mismatch here means the day
  // doesn't exist in that month — the check that a regex can't make.
  if (Number(iso.slice(8, 10)) !== day) {
    return { ok: false, error: `${MONTH_LABELS[month - 1]} ${year} has no day ${day}.` };
  }
  return { ok: true, date: iso };
}

/** An ISO date rendered in one of the Jump formats, for seeding the text box. */
export function formatJumpDate(date: string, format: JournalDateFormat): string {
  const { year, month, day } = parseIsoParts(date, "formatJumpDate");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  if (format === "YYYY-MM-DD") return `${year}-${mm}-${dd}`;
  if (format === "DD/MM/YYYY") return `${dd}/${mm}/${year}`;
  return `${mm}/${dd}/${year}`;
}

/** "Wednesday, August 12, 2026" — the selected-day panel's heading. */
export function formatCalendarDayHeading(date: string): string {
  const { year, month, day } = parseIsoParts(date, "formatCalendarDayHeading");
  const weekday = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][dayOfWeek(date)];
  return `${weekday}, ${MONTH_LABELS[month - 1]} ${day}, ${year}`;
}
