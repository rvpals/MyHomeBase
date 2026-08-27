// The front door. Everything outside this folder imports from here.

export type {
  IndexBoard,
  IndexFailure,
  IndexGroup,
  IndexGroupBoard,
  IndexQuote,
  IndexUnit,
  MarketIndex,
} from "./types";
export {
  findMarketIndex,
  INDEX_GROUPS,
  INDEX_GROUP_LABELS,
  MARKET_INDEXES,
  MARKET_INDEX_SYMBOLS,
  type MarketIndexSymbol,
} from "./catalogue";
export { indexBoardSchema, parseIndexSymbols, type IndexBoardInput } from "./schema";
export { computeIndexQuote, groupQuotes, loadIndexBoard } from "./market-indexes";
