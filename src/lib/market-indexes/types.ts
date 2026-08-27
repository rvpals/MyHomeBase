// The major market benchmarks the Stocks & ETFs dashboard shows beside your own
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
  /** Latest level/price, in cents (see above). */
  valueCents: number;
  /** The prior session's close, in cents. 0 when the provider didn't give one. */
  previousCloseCents: number;
  /** `valueCents - previousCloseCents`. Negative is a fall. */
  changeCents: number;
  /** The same as a percent of the previous close. 0 when that close is unknown. */
  changePct: number;
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
