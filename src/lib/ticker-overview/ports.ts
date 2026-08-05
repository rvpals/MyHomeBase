import type { InvestmentAccountRepository } from "@/lib/investment-accounts";
import type { StockPositionRepository } from "@/lib/stock-positions";
import type { StockWatchListRepository } from "@/lib/stock-watchlist";

/**
 * The three repositories the own-data use-case reads.
 *
 * Bundled into one object rather than passed as three positional arguments
 * because the list will grow (notes, alerts) and a caller shouldn't have to
 * remember an argument order. These are the *existing* module ports, not new
 * interfaces — this module reads through other modules' front doors and owns no
 * storage of its own.
 */
export interface TickerOwnDataDeps {
  positions: StockPositionRepository;
  accounts: InvestmentAccountRepository;
  watchLists: StockWatchListRepository;
}
