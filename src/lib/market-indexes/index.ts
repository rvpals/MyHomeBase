// The front door. Everything outside this folder imports from here.

export type {
  IndexBoard,
  IndexFailure,
  IndexGroup,
  IndexGroupBoard,
  IndexQuote,
  IndexQuoteDetail,
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
export {
  indexBoardSchema,
  parseIndexSymbols,
  type IndexBoardInput,
  type IndexBoardRequest,
} from "./schema";
export { computeIndexQuote, groupQuotes, loadIndexBoard } from "./market-indexes";
export {
  enrichIndexQuote,
  loadIndexDetail,
  rangePosition,
  INTRADAY_INTERVAL,
  INTRADAY_RANGE,
} from "./index-detail";
