import {
  computeCorrelationMatrix,
  computeSharpe,
  computeVolatility,
  saveVolatilityCache,
} from "@/lib/stock-analytics";
import { deps } from "@/lib/wiring";

// Recomputes all three analytics caches (volatility, correlation, Sharpe) from
// live market data — the command an external scheduler calls for a nightly refresh.
export async function computeAnalyticsCommand(): Promise<void> {
  const positions = deps.stockPositionRepo.listPositions();

  const volatilityResults = [];
  for (const position of positions) {
    try {
      volatilityResults.push(await computeVolatility(deps.marketDataClient, position));
    } catch (error) {
      console.error(`Volatility failed for ${position.ticker}: ${error instanceof Error ? error.message : error}`);
    }
  }
  saveVolatilityCache(deps.stockAnalyticsRepo, volatilityResults);
  console.log(`Volatility: computed ${volatilityResults.length}/${positions.length} position(s).`);

  try {
    const correlation = await computeCorrelationMatrix(deps.stockAnalyticsRepo, deps.marketDataClient, positions);
    console.log(`Correlation: computed for ${correlation.tickers.length} ticker(s).`);
  } catch (error) {
    console.error(`Correlation failed: ${error instanceof Error ? error.message : error}`);
  }

  try {
    const sharpe = await computeSharpe(deps.stockAnalyticsRepo, deps.marketDataClient, positions, {});
    console.log(`Sharpe: ratio=${sharpe.sharpeRatio ?? "n/a"}, aligned trading days=${sharpe.alignedTradingDays}.`);
  } catch (error) {
    console.error(`Sharpe failed: ${error instanceof Error ? error.message : error}`);
  }
}
