import { describe, expect, it } from "vitest";
import {
  CALENDAR_TITLE_MAX_LENGTH,
  buildMonthGrid,
  buildWeekGrid,
  buildYearGrid,
  calendarEntryLabel,
  endOfMonth,
  formatCalendarDayHeading,
  formatJumpDate,
  groupEntriesByDate,
  isJournalCalendarScope,
  isJournalDateFormat,
  journalCalendarRange,
  parseJumpDate,
  shiftCalendarAnchor,
  startOfMonth,
  startOfWeek,
  type CalendarEntryLike,
} from "./calendar";

const TODAY = "2026-08-21";

function entry(
  id: number,
  date: string,
  title = `Entry ${id}`,
  time = "09:00",
): CalendarEntryLike {
  return { id, date, title, time };
}

/** Flattens a grid's weeks into cells, for asserting on positions. */
function cells(weeks: { days: { date: string }[] }[]): string[] {
  return weeks.flatMap((week) => week.days.map((day) => day.date));
}

describe("startOfWeek / startOfMonth / endOfMonth", () => {
  it("returns the containing Sunday, and a Sunday unchanged", () => {
    // 2026-08-21 is a Friday; its week starts Sunday the 16th.
    expect(startOfWeek("2026-08-21")).toBe("2026-08-16");
    expect(startOfWeek("2026-08-16")).toBe("2026-08-16");
  });

  it("crosses a month and a year boundary", () => {
    // 2026-01-01 is a Thursday, so its week starts in December 2025.
    expect(startOfWeek("2026-01-01")).toBe("2025-12-28");
  });

  it("finds the first and last day of a month, including February in a leap year", () => {
    expect(startOfMonth("2026-08-21")).toBe("2026-08-01");
    expect(endOfMonth("2026-08-21")).toBe("2026-08-31");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2024-02-10")).toBe("2024-02-29");
  });

  it("rejects a malformed or impossible date", () => {
    expect(() => startOfWeek("08/21/2026")).toThrow(/YYYY-MM-DD/);
    expect(() => startOfWeek("2026-02-30")).toThrow(/not a real calendar date/);
    expect(() => startOfWeek("2026-13-01")).toThrow(/not a real calendar date/);
  });
});

describe("journalCalendarRange", () => {
  it("covers a month grid's six padded rows", () => {
    const range = journalCalendarRange("month", "2026-08-21");
    // August 2026 starts on a Saturday, so the grid opens on July 26.
    expect(range).toEqual({ start: "2026-07-26", end: "2026-09-05" });
  });

  it("covers exactly the anchor's Sunday-to-Saturday week", () => {
    expect(journalCalendarRange("week", "2026-08-21")).toEqual({
      start: "2026-08-16",
      end: "2026-08-22",
    });
  });

  it("covers a whole year including the padding either side", () => {
    const range = journalCalendarRange("year", "2026-08-21");
    expect(range.start).toBe("2025-12-28");
    // December 2026 starts on a Tuesday, so its grid opens Nov 29 and runs 42 days.
    expect(range.end).toBe("2027-01-09");
  });

  it("rejects a non-ISO anchor", () => {
    expect(() => journalCalendarRange("month", "2026-8-1")).toThrow(/YYYY-MM-DD/);
  });
});

describe("calendarEntryLabel", () => {
  it("leaves a title of exactly the limit alone", () => {
    const title = "a".repeat(CALENDAR_TITLE_MAX_LENGTH);
    const label = calendarEntryLabel(entry(1, TODAY, title));
    expect(label.shortTitle).toBe(title);
    expect(label.isTruncated).toBe(false);
  });

  it("elides one character over the limit", () => {
    const title = "b".repeat(CALENDAR_TITLE_MAX_LENGTH + 1);
    const label = calendarEntryLabel(entry(1, TODAY, title));
    expect(label.shortTitle).toBe(`${"b".repeat(CALENDAR_TITLE_MAX_LENGTH)}…`);
    expect(label.isTruncated).toBe(true);
    // The full title survives for the tooltip.
    expect(label.title).toBe(title);
  });

  it("keeps a title one under the limit whole", () => {
    const title = "c".repeat(CALENDAR_TITLE_MAX_LENGTH - 1);
    expect(calendarEntryLabel(entry(1, TODAY, title)).isTruncated).toBe(false);
  });

  it("labels an untitled entry rather than rendering an empty row", () => {
    const label = calendarEntryLabel(entry(1, TODAY, "   "));
    expect(label.shortTitle).toBe("(untitled)");
    expect(label.title).toBe("(untitled)");
  });
});

describe("groupEntriesByDate", () => {
  it("buckets by date and sorts each bucket by time", () => {
    const grouped = groupEntriesByDate([
      entry(1, "2026-08-21", "Evening", "21:00"),
      entry(2, "2026-08-21", "Morning", "07:30"),
      entry(3, "2026-08-20", "Other day", "12:00"),
    ]);
    expect(grouped.get("2026-08-21")?.map((label) => label.title)).toEqual([
      "Morning",
      "Evening",
    ]);
    expect(grouped.get("2026-08-20")).toHaveLength(1);
    expect(grouped.has("2026-08-19")).toBe(false);
  });

  it("sorts untimed entries after timed ones", () => {
    const grouped = groupEntriesByDate([
      entry(1, "2026-08-21", "No time", ""),
      entry(2, "2026-08-21", "Timed", "23:59"),
    ]);
    expect(grouped.get("2026-08-21")?.map((label) => label.title)).toEqual([
      "Timed",
      "No time",
    ]);
  });

  it("breaks a tie on id, so the order is stable", () => {
    const grouped = groupEntriesByDate([
      entry(9, "2026-08-21", "Later id", "08:00"),
      entry(4, "2026-08-21", "Earlier id", "08:00"),
    ]);
    expect(grouped.get("2026-08-21")?.map((label) => label.id)).toEqual([4, 9]);
  });
});

describe("buildMonthGrid", () => {
  it("builds six rows of seven, Sunday first, when the 1st is a Saturday", () => {
    // August 2026: the 1st is a Saturday — the maximum leading padding.
    const grid = buildMonthGrid({ anchor: "2026-08-10", entries: [], today: TODAY });
    expect(grid.weeks).toHaveLength(6);
    expect(grid.weeks.every((week) => week.days.length === 7)).toBe(true);
    const flat = cells(grid.weeks);
    expect(flat[0]).toBe("2026-07-26");
    expect(flat.at(-1)).toBe("2026-09-05");
    expect(grid.title).toBe("August 2026");
  });

  it("builds six rows when the 1st is a Sunday, so nothing leads", () => {
    // February 2026 starts on a Sunday.
    const grid = buildMonthGrid({ anchor: "2026-02-15", entries: [], today: TODAY });
    const flat = cells(grid.weeks);
    expect(flat[0]).toBe("2026-02-01");
    expect(grid.weeks).toHaveLength(6);
    // Still 42 cells, so the grid height never changes between months.
    expect(flat).toHaveLength(42);
  });

  it("marks today, the selection, and the borrowed padding days", () => {
    const grid = buildMonthGrid({
      anchor: "2026-08-01",
      entries: [],
      today: TODAY,
      selectedDate: "2026-08-12",
    });
    const flat = grid.weeks.flatMap((week) => week.days);
    expect(flat.find((day) => day.date === TODAY)?.isToday).toBe(true);
    expect(flat.find((day) => day.date === "2026-08-12")?.isSelected).toBe(true);
    expect(flat.find((day) => day.date === "2026-08-12")?.isToday).toBe(false);
    // July's tail renders, but is not part of August.
    expect(flat.find((day) => day.date === "2026-07-28")?.isCurrentPeriod).toBe(false);
    expect(flat.find((day) => day.date === "2026-08-28")?.isCurrentPeriod).toBe(true);
  });

  it("places entries in their day and counts only the current month", () => {
    const grid = buildMonthGrid({
      anchor: "2026-08-01",
      entries: [
        entry(1, "2026-08-12", "In August"),
        entry(2, "2026-08-12", "Also August"),
        // A padding day: shown in the cell, excluded from the month's count.
        entry(3, "2026-07-28", "In July"),
      ],
      today: TODAY,
    });
    const flat = grid.weeks.flatMap((week) => week.days);
    expect(flat.find((day) => day.date === "2026-08-12")?.entries).toHaveLength(2);
    expect(flat.find((day) => day.date === "2026-07-28")?.entries).toHaveLength(1);
    expect(grid.entryCount).toBe(2);
  });
});

describe("buildWeekGrid", () => {
  it("builds the anchor's single week with nothing dimmed", () => {
    const grid = buildWeekGrid({ anchor: "2026-08-21", entries: [], today: TODAY });
    expect(grid.weeks).toHaveLength(1);
    expect(cells(grid.weeks)).toEqual([
      "2026-08-16",
      "2026-08-17",
      "2026-08-18",
      "2026-08-19",
      "2026-08-20",
      "2026-08-21",
      "2026-08-22",
    ]);
    expect(grid.weeks[0].days.every((day) => day.isCurrentPeriod)).toBe(true);
  });

  it("titles a week inside one month compactly", () => {
    expect(buildWeekGrid({ anchor: "2026-08-21", entries: [], today: TODAY }).title).toBe(
      "August 16 – 22, 2026",
    );
  });

  it("titles a week that straddles two months", () => {
    // 2026-03-29 (Sunday) through 2026-04-04.
    expect(buildWeekGrid({ anchor: "2026-03-31", entries: [], today: TODAY }).title).toBe(
      "Mar 29 – Apr 4, 2026",
    );
  });

  it("titles a week that straddles a year", () => {
    const grid = buildWeekGrid({ anchor: "2026-01-01", entries: [], today: TODAY });
    expect(grid.title).toBe("Dec 28 – Jan 3, 2026 (from 2025)");
    expect(cells(grid.weeks)[0]).toBe("2025-12-28");
  });

  it("counts every entry in the week", () => {
    const grid = buildWeekGrid({
      anchor: "2026-08-21",
      entries: [entry(1, "2026-08-16"), entry(2, "2026-08-22"), entry(3, "2026-08-23")],
      today: TODAY,
    });
    // The 23rd is the next week's Sunday, so it isn't here.
    expect(grid.entryCount).toBe(2);
  });
});

describe("buildYearGrid", () => {
  it("builds twelve months of six rows each", () => {
    const grid = buildYearGrid({ anchor: "2026-08-21", entries: [], today: TODAY });
    expect(grid.months).toHaveLength(12);
    expect(grid.months.map((month) => month.label)[0]).toBe("January");
    expect(grid.months.every((month) => month.weeks.length === 6)).toBe(true);
    expect(grid.year).toBe(2026);
    expect(grid.title).toBe("2026");
  });

  it("counts per month and reports the busiest day for the heat scale", () => {
    const grid = buildYearGrid({
      anchor: "2026-06-01",
      entries: [
        entry(1, "2026-03-04"),
        entry(2, "2026-03-04"),
        entry(3, "2026-03-04"),
        entry(4, "2026-09-09"),
      ],
      today: TODAY,
    });
    expect(grid.months[2].entryCount).toBe(3);
    expect(grid.months[8].entryCount).toBe(1);
    expect(grid.months[0].entryCount).toBe(0);
    expect(grid.entryCount).toBe(4);
    expect(grid.maxDayEntryCount).toBe(3);
  });

  it("does not double-count a day that pads two adjacent months", () => {
    // 2026-08-31 is a Monday, so it appears in August's grid and in September's
    // leading padding. It must count once, under August.
    const grid = buildYearGrid({
      anchor: "2026-01-01",
      entries: [entry(1, "2026-08-31")],
      today: TODAY,
    });
    expect(grid.entryCount).toBe(1);
    expect(grid.months[7].entryCount).toBe(1);
    expect(grid.months[8].entryCount).toBe(0);
  });

  it("reports a zero maximum for an empty year, so shading has no divide-by-zero", () => {
    const grid = buildYearGrid({ anchor: "2026-01-01", entries: [], today: TODAY });
    expect(grid.maxDayEntryCount).toBe(0);
    expect(grid.entryCount).toBe(0);
  });
});

describe("shiftCalendarAnchor", () => {
  it("steps a week by seven days, in both directions", () => {
    expect(shiftCalendarAnchor("week", "2026-08-21", 1)).toBe("2026-08-28");
    expect(shiftCalendarAnchor("week", "2026-08-21", -1)).toBe("2026-08-14");
  });

  it("steps a month, crossing a year boundary either way", () => {
    expect(shiftCalendarAnchor("month", "2026-12-10", 1)).toBe("2027-01-10");
    expect(shiftCalendarAnchor("month", "2026-01-10", -1)).toBe("2025-12-10");
  });

  it("clamps the day instead of rolling over, so back-then-forward returns", () => {
    // Jan 31 + 1 month is Feb 28 (2026 is not a leap year), not Mar 3.
    expect(shiftCalendarAnchor("month", "2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftCalendarAnchor("month", "2026-03-31", -1)).toBe("2026-02-28");
    expect(shiftCalendarAnchor("month", "2024-01-31", 1)).toBe("2024-02-29");
  });

  it("steps a year, clamping Feb 29 into a non-leap year", () => {
    expect(shiftCalendarAnchor("year", "2026-08-21", 1)).toBe("2027-08-21");
    expect(shiftCalendarAnchor("year", "2024-02-29", 1)).toBe("2025-02-28");
  });

  it("returns the anchor unchanged for a zero step", () => {
    expect(shiftCalendarAnchor("month", "2026-08-21", 0)).toBe("2026-08-21");
  });

  it("rejects a fractional step", () => {
    expect(() => shiftCalendarAnchor("month", "2026-08-21", 1.5)).toThrow(/integer/);
  });
});

describe("parseJumpDate", () => {
  it("reads the default MM/DD/YYYY", () => {
    expect(parseJumpDate("08/21/2026")).toEqual({ ok: true, date: "2026-08-21" });
    expect(parseJumpDate("8/1/2026")).toEqual({ ok: true, date: "2026-08-01" });
  });

  it("reads the same digits differently in DD/MM/YYYY", () => {
    // The whole reason the format is a parameter rather than a guess.
    expect(parseJumpDate("01/02/2026", "MM/DD/YYYY")).toEqual({ ok: true, date: "2026-01-02" });
    expect(parseJumpDate("01/02/2026", "DD/MM/YYYY")).toEqual({ ok: true, date: "2026-02-01" });
  });

  it("reads YYYY-MM-DD", () => {
    expect(parseJumpDate("2026-08-21", "YYYY-MM-DD")).toEqual({ ok: true, date: "2026-08-21" });
  });

  it("accepts . and - as separators without changing the field order", () => {
    expect(parseJumpDate("08-21-2026")).toEqual({ ok: true, date: "2026-08-21" });
    expect(parseJumpDate("08.21.2026")).toEqual({ ok: true, date: "2026-08-21" });
  });

  it("rejects an empty or blank box", () => {
    expect(parseJumpDate("")).toEqual({ ok: false, error: "Enter a date." });
    expect(parseJumpDate("   ")).toEqual({ ok: false, error: "Enter a date." });
  });

  it("rejects text in the wrong format for the selected one", () => {
    // A valid ISO date is still wrong when MM/DD/YYYY is selected.
    const result = parseJumpDate("2026-08-21", "MM/DD/YYYY");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("MM/DD/YYYY");
  });

  it("rejects non-numeric and half-typed input", () => {
    expect(parseJumpDate("aa/bb/cccc").ok).toBe(false);
    expect(parseJumpDate("08/21").ok).toBe(false);
    expect(parseJumpDate("08/21/26").ok).toBe(false);
    expect(parseJumpDate("08/21/2026 extra").ok).toBe(false);
  });

  it("rejects an out-of-range month or day", () => {
    const month = parseJumpDate("13/01/2026");
    expect(month.ok === false && month.error).toBe("There is no month 13.");
    const day = parseJumpDate("01/40/2026");
    expect(day.ok === false && day.error).toBe("There is no day 40.");
  });

  it("rejects a day that does not exist in that month", () => {
    const result = parseJumpDate("02/30/2026");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe("February 2026 has no day 30.");
    // Feb 29 exists in a leap year and not otherwise.
    expect(parseJumpDate("02/29/2024")).toEqual({ ok: true, date: "2024-02-29" });
    expect(parseJumpDate("02/29/2026").ok).toBe(false);
  });
});

describe("formatJumpDate", () => {
  it("renders an ISO date in each format, zero-padded", () => {
    expect(formatJumpDate("2026-08-01", "MM/DD/YYYY")).toBe("08/01/2026");
    expect(formatJumpDate("2026-08-01", "DD/MM/YYYY")).toBe("01/08/2026");
    expect(formatJumpDate("2026-08-01", "YYYY-MM-DD")).toBe("2026-08-01");
  });

  it("round-trips through parseJumpDate in every format", () => {
    for (const format of ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"] as const) {
      expect(parseJumpDate(formatJumpDate("2026-03-09", format), format)).toEqual({
        ok: true,
        date: "2026-03-09",
      });
    }
  });
});

describe("formatCalendarDayHeading", () => {
  it("names the weekday, month, day and year", () => {
    expect(formatCalendarDayHeading("2026-08-21")).toBe("Friday, August 21, 2026");
    expect(formatCalendarDayHeading("2026-01-04")).toBe("Sunday, January 4, 2026");
  });
});

describe("scope and format guards", () => {
  it("accepts the known values and rejects anything else", () => {
    expect(isJournalCalendarScope("month")).toBe(true);
    expect(isJournalCalendarScope("year")).toBe(true);
    expect(isJournalCalendarScope("decade")).toBe(false);
    expect(isJournalDateFormat("MM/DD/YYYY")).toBe(true);
    expect(isJournalDateFormat("DD.MM.YY")).toBe(false);
  });
});
