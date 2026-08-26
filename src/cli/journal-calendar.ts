import {
  buildMonthGrid,
  buildWeekGrid,
  buildYearGrid,
  groupEntriesByDate,
  isJournalCalendarScope,
  isJournalDateFormat,
  journalCalendarRange,
  listEntriesInDateRange,
  parseJumpDate,
  WEEKDAY_LABELS,
  type CalendarWeek,
  type JournalCalendarScope,
} from "@/lib/journal";
import { todayIsoLocal } from "@/lib/shared/date";
import { deps } from "@/lib/wiring";
import { parseFlags } from "./parse-flags";

/**
 * Prints the Journal calendar — the same grid the web screen draws, from the
 * same library functions.
 *
 *   journal-calendar
 *   journal-calendar --scope week
 *   journal-calendar --scope year --date 2025-01-01
 *   journal-calendar --date 08/21/2026 --format MM/DD/YYYY
 *   journal-calendar --date 2026-08-21 --day
 *
 * This is the proof that the calendar's logic really is in `src/lib/`: the shape
 * of the grid, the padding, the 30-character title elision and the date parsing
 * all come from the library, and this file only prints what it's handed. If the
 * grid couldn't be printed here, the logic would have leaked into the view.
 *
 * `--date` accepts an ISO date, or any of the Jump formats with `--format` —
 * the same `parseJumpDate` the web Jump box uses, so a date that works in one
 * works in the other.
 */
export async function journalCalendarCommand(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  const rawScope = flags.scope ?? "month";
  if (!isJournalCalendarScope(rawScope)) {
    console.error(`Unknown --scope "${rawScope}". Use month, week, or year.`);
    process.exitCode = 1;
    return;
  }
  const scope: JournalCalendarScope = rawScope;

  const rawFormat = flags.format;
  if (rawFormat !== undefined && !isJournalDateFormat(rawFormat)) {
    console.error(`Unknown --format "${rawFormat}". Use MM/DD/YYYY, DD/MM/YYYY, or YYYY-MM-DD.`);
    process.exitCode = 1;
    return;
  }

  const today = todayIsoLocal();
  let anchor = today;
  if (flags.date) {
    // The same parser the web Jump box uses — one grammar, two front-ends.
    const parsed = parseJumpDate(flags.date, rawFormat ?? "YYYY-MM-DD");
    if (!parsed.ok) {
      console.error(parsed.error);
      process.exitCode = 1;
      return;
    }
    anchor = parsed.date;
  }

  const range = journalCalendarRange(scope, anchor);
  const entries = listEntriesInDateRange(deps.journalRepo, range.start, range.end);
  // `--day` lists one date's entries in full — the terminal equivalent of
  // clicking a cell. Read from argv rather than the parsed flags because
  // parseFlags treats every flag as taking a value, so `--day --scope week`
  // would have `--day` eat `--scope`. Put `--day` last, or use it bare.
  const selectedDate = args.includes("--day") ? anchor : undefined;

  if (scope === "year") {
    const grid = buildYearGrid({ anchor, entries, today, selectedDate });
    console.log(`${grid.title} — ${grid.entryCount} entries`);
    console.log("");
    for (const month of grid.months) {
      console.log(`  ${month.label.padEnd(10)} ${String(month.entryCount).padStart(4)}`);
    }
    console.log("");
    console.log(`Busiest day: ${grid.maxDayEntryCount} entries`);
  } else {
    const grid =
      scope === "week"
        ? buildWeekGrid({ anchor, entries, today, selectedDate })
        : buildMonthGrid({ anchor, entries, today, selectedDate });
    console.log(`${grid.title} — ${grid.entryCount} entries`);
    console.log("");
    printWeeks(grid.weeks);
  }

  if (selectedDate !== undefined) {
    // groupEntriesByDate, not a filter of `entries` in repository order: it puts
    // the day in the same sequence the web list uses — timed first, untimed last
    // — and applies the same title elision.
    const onDay = groupEntriesByDate(entries).get(selectedDate) ?? [];
    console.log("");
    console.log(`${selectedDate} — ${onDay.length} ${onDay.length === 1 ? "entry" : "entries"}`);
    for (const entry of onDay) {
      const time = entry.time === "" ? "  —  " : entry.time.slice(0, 5).padEnd(5);
      console.log(`  ${time}  ${entry.title}`);
    }
  }
}

/** A month/week grid as fixed-width columns, one entry title per cell line. */
function printWeeks(weeks: CalendarWeek[]): void {
  const columnWidth = 14;
  console.log(WEEKDAY_LABELS.map((label) => label.padEnd(columnWidth)).join(""));

  for (const week of weeks) {
    // Row one: the day numbers, with a marker for today and the selection.
    console.log(
      week.days
        .map((day) => {
          const number = String(day.dayOfMonth).padStart(2);
          const mark = day.isToday ? "*" : day.isSelected ? ">" : day.isCurrentPeriod ? " " : ".";
          const count = day.entries.length === 0 ? "" : ` (${day.entries.length})`;
          return `${mark}${number}${count}`.padEnd(columnWidth);
        })
        .join(""),
    );

    // Then one line per title, as deep as the busiest day in the row.
    const deepest = Math.max(...week.days.map((day) => day.entries.length));
    for (let line = 0; line < deepest; line += 1) {
      console.log(
        week.days
          .map((day) => {
            const entry = day.entries[line];
            if (!entry) return "".padEnd(columnWidth);
            // shortTitle is the library's 30-char elision; trimmed further here
            // only because a terminal column is narrower than a web cell.
            return ` ${entry.shortTitle.slice(0, columnWidth - 2)}`.padEnd(columnWidth);
          })
          .join("")
          .trimEnd(),
      );
    }
    console.log("");
  }
  console.log("* today   > selected   . other month");
}
