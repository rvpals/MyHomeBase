/**
 * One reading of the calendar, formatted for display.
 *
 * Split into fields rather than one pre-baked string because the card lays the three
 * out differently — the date large, the week number as a chip beside it — and a widget
 * that has to re-split a sentence to style half of it is a formatter in the wrong place.
 *
 * The time is deliberately **absent**. It belongs to the browser's clock, not the
 * server's, and it changes every second; see `describeClock`.
 */
export interface ClockReading {
  /** The local-calendar day this reading is for, "YYYY-MM-DD". */
  isoDate: string;
  /** The day of the week in full: "Sunday". */
  weekday: string;
  /** The date without its weekday: "13 September 2026". */
  longDate: string;
  /** The ISO-8601 week of the year, 1-53. */
  weekNumber: number;
  /**
   * The year the ISO week belongs to, which is **not always the calendar year** —
   * 2027-01-01 falls in week 53 of 2026. Carried so a caller can label the week
   * unambiguously across a year boundary.
   */
  weekYear: number;
}
