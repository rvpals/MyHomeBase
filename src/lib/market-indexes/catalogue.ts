import type { IndexGroup, MarketIndex } from "./types";

/** Group headings, kept beside the groups themselves so the view invents nothing. */
export const INDEX_GROUP_LABELS: Record<IndexGroup, string> = {
  equity: "US equity",
  commodity: "Commodities",
  rates: "Rates & currency",
  crypto: "Crypto",
};

/** The order groups are drawn in. */
export const INDEX_GROUPS: readonly IndexGroup[] = [
  "equity",
  "commodity",
  "rates",
  "crypto",
] as const;

/**
 * The board, in display order within each group.
 *
 * Yahoo's symbols, used verbatim: `^` prefixes an index, `=F` a futures front
 * month, and `DX-Y.NYB` is ICE's dollar index. `getQuote` reaches all of them
 * through the same chart endpoint a normal ticker uses, so none of these needed
 * a new client method.
 *
 * `^TNX` is the odd one out and worth knowing about: it quotes the 10-year yield
 * *as a percentage already* (4.27 means 4.27%), which is why it carries the
 * `percent` unit rather than being divided by anything downstream.
 */
export const MARKET_INDEXES: readonly MarketIndex[] = [
  { symbol: "^GSPC", label: "S&P 500", group: "equity", unit: "points" },
  { symbol: "^IXIC", label: "NASDAQ Composite", group: "equity", unit: "points" },
  { symbol: "^DJI", label: "Dow Jones Industrial", group: "equity", unit: "points" },
  { symbol: "^RUT", label: "Russell 2000", group: "equity", unit: "points" },
  { symbol: "^VIX", label: "Volatility (VIX)", group: "equity", unit: "points" },
  { symbol: "GC=F", label: "Gold", group: "commodity", unit: "currency" },
  { symbol: "SI=F", label: "Silver", group: "commodity", unit: "currency" },
  { symbol: "CL=F", label: "Crude Oil (WTI)", group: "commodity", unit: "currency" },
  { symbol: "^TNX", label: "10-Yr Treasury Yield", group: "rates", unit: "percent" },
  { symbol: "DX-Y.NYB", label: "US Dollar Index", group: "rates", unit: "points" },
  { symbol: "BTC-USD", label: "Bitcoin", group: "crypto", unit: "currency" },
] as const;

/**
 * Every symbol on the board, as literal types.
 *
 * Spelled out rather than derived with `.map()`, which widens to `string[]` and
 * would make the boundary schema's `z.enum` accept any string — turning "is this
 * in the catalogue?" into a runtime-only question. The cost is one list written
 * twice; `market-indexes.test.ts` asserts the two stay in step, so a symbol
 * added to one and not the other fails the suite rather than shipping.
 */
export const MARKET_INDEX_SYMBOLS = [
  "^GSPC",
  "^IXIC",
  "^DJI",
  "^RUT",
  "^VIX",
  "GC=F",
  "SI=F",
  "CL=F",
  "^TNX",
  "DX-Y.NYB",
  "BTC-USD",
] as const;

export type MarketIndexSymbol = (typeof MARKET_INDEX_SYMBOLS)[number];

/** Catalogue lookup by symbol, for validating a filtered request. */
export function findMarketIndex(symbol: string): MarketIndex | undefined {
  return MARKET_INDEXES.find((index) => index.symbol === symbol);
}
