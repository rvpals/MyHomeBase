// The public surface of the market calendar.
//
// Pure and dependency-free: no repository, no client, nothing from `deps`. Safe
// to import from a client component as well as from a background job.

export {
  MARKET_CLOSURES,
  MARKET_CLOSURE_LABELS,
  MARKET_TIME_ZONE,
  type MarketClosure,
} from "./types";
export {
  describeMarketClosure,
  isMarketDay,
  isMarketHoliday,
  isWeekend,
  marketClosure,
  nextMarketDay,
} from "./market-calendar";
