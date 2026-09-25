// The major market benchmarks the Investments dashboard shows beside your own
// portfolio: the three US equity indexes, small caps, volatility, the metals,
// oil, rates, the dollar, and bitcoin.
//
// These are *reference* numbers, not holdings. Nothing here reads the positions
// table — the whole module is a catalogue plus one fetch over it.

/**
 * What kind of number an index quotes, which decides how it's formatted.
 *
 * Not cosmetic: `^TNX` quotes a yield in percent and `^GSPC` quotes points, and
 * printing either as dollars would be a lie. `points` covers an index level,
 * `currency` a real price in USD, `percent` a rate.
 */
export type IndexUnit = "points" | "currency" | "percent";

/** The bands the card groups by, in the order they're drawn. */
export type IndexGroup = "equity" | "commodity" | "rates" | "crypto";

/** One entry in the catalogue — the provider's symbol and how to label it. */
export interface MarketIndex {
  /** The provider's symbol, e.g. `^GSPC`. Passed to the market-data client as-is. */
  symbol: string;
  label: string;
  group: IndexGroup;
  unit: IndexUnit;
  /**
   * The website of the organisation behind the index, used to fetch its icon.
   *
   * An index has no stock logo to look up — it isn't a company — but the body
   * that publishes it does have a site, so the icon is found by domain rather
   * than by symbol. Empty string means "no icon"; the row draws its monogram.
   */
  logoDomain: string;
}

/**
 * One index's current standing.
 *
 * Everything is in cents — even a yield and an index level — so the whole board
 * shares one integer representation and the view formats once. A yield of 4.27%
 * is 427; the S&P at 5,432.10 points is 543_210.
 */
export interface IndexQuote {
  symbol: string;
  label: string;
  group: IndexGroup;
  unit: IndexUnit;
  /** Carried through from the catalogue so the card can draw the icon. */
  logoDomain: string;
  /** Latest level/price, in cents (see above). */
  valueCents: number;
  /** The prior session's close, in cents. 0 when the provider didn't give one. */
  previousCloseCents: number;
  /** `valueCents - previousCloseCents`. Negative is a fall. */
  changeCents: number;
  /** The same as a percent of the previous close. 0 when that close is unknown. */
  changePct: number;
  /**
   * Today's extremes, in cents. 0 means the provider didn't report one — the
   * same convention `previousCloseCents` uses, and for the same reason: these
   * ride along in the quote that was already fetched, so an absent value is
   * "not said" rather than "not asked for".
   */
  dayHighCents: number;
  dayLowCents: number;
  /**
   * The richer reference figures, which cost a second provider call and so are
   * only present when the board was loaded with `includeDetail`.
   *
   * Undefined therefore means one of two different things — not requested, or
   * requested and unavailable — and the card draws an em-dash either way. The
   * distinction matters to nobody reading the screen, and collapsing it keeps
   * the row from carrying a per-field status.
   */
  detail?: IndexQuoteDetail;
}

/**
 * The second-pass figures for one index.
 *
 * Every field is optional because coverage genuinely varies by symbol, and this
 * was measured rather than assumed (2026-09-24, all eleven catalogue symbols):
 * the 52-week range, both moving averages and the all-time high came back for
 * all of them, while `oneYearChangePct` is absent for the three commodity
 * futures — Yahoo returns an empty `defaultKeyStatistics` for `GC=F`, `SI=F`
 * and `CL=F`.
 *
 * Two fields Yahoo *appears* to offer are deliberately not here. `ytdReturn` is
 * present as a key on every symbol but null on all eleven — it's a fund field.
 * `allTimeLow` is real but historically literal (the S&P's is 4.40, from the
 * 1930s; crude oil's is -40.32, from April 2020), which reads as a broken row
 * rather than as context. Neither is worth a column.
 */
export interface IndexQuoteDetail {
  /** The 52-week range, in cents. */
  fiftyTwoWeekLowCents?: number;
  fiftyTwoWeekHighCents?: number;
  /** Trailing one-year change, as a percentage. Absent for the futures. */
  oneYearChangePct?: number;
  /** Trend context: the 50- and 200-session averages, in cents. */
  fiftyDayAverageCents?: number;
  twoHundredDayAverageCents?: number;
  /** The record high, in cents. Its low counterpart is omitted — see above. */
  allTimeHighCents?: number;
  /**
   * Today's intraday closes in cents, oldest first, for the sparkline.
   *
   * Empty when the history call failed or the session hasn't opened. The window
   * differs per symbol — a 24/7 crypto series starts at midnight, a US index at
   * the opening bell — so these are **not comparable across rows**, and the
   * card says so rather than implying a shared axis.
   */
  intradayCents: number[];
}

/** A symbol that couldn't be quoted, and why. Reported, never thrown. */
export interface IndexFailure {
  symbol: string;
  label: string;
  reason: string;
}

/** One group's quotes, kept together so the view doesn't have to re-bucket. */
export interface IndexGroupBoard {
  group: IndexGroup;
  label: string;
  quotes: IndexQuote[];
}

/** The whole card's worth of data from one run. */
export interface IndexBoard {
  /** When the fetch happened, ISO. The numbers are only as fresh as this. */
  fetchedAt: string;
  /** Non-empty groups, in catalogue order. */
  groups: IndexGroupBoard[];
  /** Symbols that returned nothing usable. */
  failures: IndexFailure[];
}
