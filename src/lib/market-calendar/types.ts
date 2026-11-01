// Why the US equity market is shut on a given calendar day.

/**
 * The ten full closures the NYSE and Nasdaq observe, plus the weekend.
 *
 * A closed set rather than a free string so a caller can branch on the reason
 * without matching prose, and so the labels below are the single source of the
 * wording that reaches a skip message.
 *
 * **Full closures only.** The three early-close days (the Friday after
 * Thanksgiving, Christmas Eve, and the day before Independence Day when it
 * falls midweek) are *not* here: the market traded that morning and closed at
 * 13:00, so there are real closing prices to fetch. Treating them as closures
 * would skip a day whose prices moved.
 */
export const MARKET_CLOSURES = [
  "weekend",
  "new-years-day",
  "martin-luther-king-jr-day",
  "washingtons-birthday",
  "good-friday",
  "memorial-day",
  "juneteenth",
  "independence-day",
  "labor-day",
  "thanksgiving",
  "christmas",
] as const;

/** Why the market is shut. `undefined` elsewhere means it is a trading day. */
export type MarketClosure = (typeof MARKET_CLOSURES)[number];

/** How each closure is written in a message. Presentation never invents its own. */
export const MARKET_CLOSURE_LABELS: Record<MarketClosure, string> = {
  weekend: "the weekend",
  "new-years-day": "New Year's Day",
  "martin-luther-king-jr-day": "Martin Luther King, Jr. Day",
  "washingtons-birthday": "Washington's Birthday",
  "good-friday": "Good Friday",
  "memorial-day": "Memorial Day",
  juneteenth: "Juneteenth National Independence Day",
  "independence-day": "Independence Day",
  "labor-day": "Labor Day",
  thanksgiving: "Thanksgiving Day",
  christmas: "Christmas Day",
};

/**
 * The timezone the market's calendar day is read in.
 *
 * Lives here rather than in the job because it is a fact about the market, not
 * about the scheduler. The NAS is not on Eastern time and need not be.
 */
export const MARKET_TIME_ZONE = "America/New_York";
