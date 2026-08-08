import type { InvestmentAccountRepository } from "@/lib/investment-accounts";
import type { StockPositionRepository } from "@/lib/stock-positions";
import type { StockWatchListRepository } from "@/lib/stock-watchlist";
import type { TickerRisk } from "./types";

/**
 * The three repositories the own-data use-case reads.
 *
 * Bundled into one object rather than passed as three positional arguments
 * because the list will grow (notes, alerts) and a caller shouldn't have to
 * remember an argument order. These are the *existing* module ports, not new
 * interfaces — for its own data, this module reads through other modules' front
 * doors.
 */
export interface TickerOwnDataDeps {
  positions: StockPositionRepository;
  accounts: InvestmentAccountRepository;
  watchLists: StockWatchListRepository;
}

/**
 * The one table this module owns: computed risk figures, keyed by ticker.
 *
 * Deliberately not `stk_stock_volatility_cache` — that one is owned by the
 * analytics dashboard and cleared wholesale on every refresh, so a per-ticker
 * write there would not survive. See `migrations/0039_create_ticker_risk_cache.md`.
 */
export interface TickerRiskCacheRepository {
  /** The stored figures, or undefined when this ticker has never been computed. */
  get(ticker: string): TickerRisk | undefined;
  /** Upsert by ticker. `calculatedAt` on the record is what gets stored. */
  save(risk: TickerRisk): void;
}
