import type { MarketDataClient } from "@/lib/market-data";
import type { StockPosition } from "@/lib/stock-positions";
import type { StockAnalyticsRepository } from "./ports";
import { computeSharpeInputSchema } from "./schema";
import type { ComputeSharpeInput } from "./schema";
import {
  alignSeriesByTimestamp,
  annualizeReturn,
  annualizeStdDev,
  classifyVolatility,
  computePortfolioDailyReturns,
  computePortfolioWeights,
  computeRangePositionPct,
  computeSharpeRatio as computeSharpeRatioStat,
  computeVolatilityStats,
  dailyReturns,
  dailyRiskFreeRate,
  lookbackDaysToYahooRange,
  pearsonCorrelation,
} from "./stats";
import type { CorrelationResult, SharpeResult, SharpeTickerDetail, VolatilityResult } from "./types";

const MARKET_BENCHMARK_TICKER = "SPY";
const MINIMUM_RETURN_OBSERVATIONS = 30;
const HISTORY_RANGE_1Y = "1y";
const HISTORY_INTERVAL_1D = "1d";

/** Only Stock/ETF positions with a positive quantity are eligible for correlation/Sharpe analytics. */
function selectAnalyticsEligiblePositions(positions: StockPosition[]): StockPosition[] {
  return positions.filter(
    (position) => position.quantity > 0 && (position.type === "Stock" || position.type === "ETF"),
  );
}

export async function computeVolatility(
  client: MarketDataClient,
  position: Pick<StockPosition, "ticker" | "name" | "type" | "quantity" | "currentPriceCents">,
): Promise<VolatilityResult> {
  const [history, quote] = await Promise.all([
    client.getHistory(position.ticker, HISTORY_RANGE_1Y, HISTORY_INTERVAL_1D),
    client.getQuote(position.ticker),
  ]);

  const closes = history.map((point) => point.closeCents).filter((close) => close > 0);
  const stats = computeVolatilityStats(closes);
  const low52wCents = closes.length ? Math.min(...closes) : 0;
  const high52wCents = closes.length ? Math.max(...closes) : 0;

  return {
    ticker: position.ticker,
    companyName: quote.shortName || position.name || undefined,
    type: position.type,
    shares: position.quantity,
    currentPriceCents: quote.priceCents,
    annualizedVolPct: stats.annualizedVolPct,
    dailyStdDevPct: stats.dailyStdDevPct,
    volatilityLabel: classifyVolatility(stats.annualizedVolPct),
    low52wCents,
    high52wCents,
    rangePositionPct: computeRangePositionPct(quote.priceCents, low52wCents, high52wCents),
    sampleCount: closes.length,
    calculatedAt: new Date().toISOString(),
  };
}

export function listVolatilityCache(repo: StockAnalyticsRepository): VolatilityResult[] {
  return repo.listVolatilityCache();
}

export function saveVolatilityCache(repo: StockAnalyticsRepository, results: VolatilityResult[]): void {
  repo.saveVolatilityCache(results);
}

export function clearVolatilityCache(repo: StockAnalyticsRepository): void {
  repo.clearVolatilityCache();
}

export function getCorrelationCache(repo: StockAnalyticsRepository): CorrelationResult | undefined {
  return repo.getCorrelationCache();
}

/**
 * Builds an N×N Pearson correlation matrix across eligible positions' daily
 * returns (plus each ticker's correlation to the SPY benchmark), and caches
 * the result. Tolerates individual ticker fetch failures.
 */
export async function computeCorrelationMatrix(
  repo: StockAnalyticsRepository,
  client: MarketDataClient,
  positions: StockPosition[],
): Promise<CorrelationResult> {
  const eligible = selectAnalyticsEligiblePositions(positions);
  if (eligible.length < 2) {
    throw new Error("Need at least 2 Stock or ETF positions to compute a correlation matrix.");
  }

  const failedTickers: string[] = [];
  const historyByTicker: Record<string, { timestamp: number; closeCents: number }[]> = {};

  await Promise.all(
    eligible.map(async (position) => {
      try {
        const history = await client.getHistory(position.ticker, HISTORY_RANGE_1Y, HISTORY_INTERVAL_1D);
        if (history.length < 10) throw new Error("Insufficient price history");
        historyByTicker[position.ticker] = history;
      } catch {
        failedTickers.push(position.ticker);
      }
    }),
  );

  const validTickers = eligible.map((position) => position.ticker).filter((ticker) => historyByTicker[ticker]);
  if (validTickers.length < 2) {
    throw new Error("Not enough tickers with sufficient price history to compute the matrix.");
  }

  let marketHistory: { timestamp: number; closeCents: number }[] = [];
  try {
    marketHistory = await client.getHistory(MARKET_BENCHMARK_TICKER, HISTORY_RANGE_1Y, HISTORY_INTERVAL_1D);
  } catch {
    marketHistory = [];
  }

  const { timestamps, closesByTicker } = alignSeriesByTimestamp(
    Object.fromEntries(validTickers.map((ticker) => [ticker, historyByTicker[ticker]])),
  );

  const returnsByTicker: Record<string, number[]> = {};
  for (const ticker of validTickers) {
    returnsByTicker[ticker] = dailyReturns(closesByTicker[ticker]);
  }

  const n = validTickers.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        matrix[i][j] = 1;
      } else if (j < i) {
        matrix[i][j] = matrix[j][i];
      } else {
        const a = returnsByTicker[validTickers[i]];
        const b = returnsByTicker[validTickers[j]];
        const len = Math.min(a.length, b.length);
        matrix[i][j] = pearsonCorrelation(a.slice(0, len), b.slice(0, len)) ?? 0;
      }
    }
  }

  const marketCloseByTimestamp = new Map(marketHistory.map((point) => [point.timestamp, point.closeCents]));
  const marketCorrelation: Record<string, number | null> = {};
  for (const ticker of validTickers) {
    const sharedTimestamps = timestamps.filter((timestamp) => marketCloseByTimestamp.has(timestamp));
    if (sharedTimestamps.length < 5) {
      marketCorrelation[ticker] = null;
      continue;
    }
    const tickerCloseByTimestamp = new Map(historyByTicker[ticker].map((point) => [point.timestamp, point.closeCents]));
    const tickerCloses = sharedTimestamps.map((timestamp) => tickerCloseByTimestamp.get(timestamp) as number);
    const marketCloses = sharedTimestamps.map((timestamp) => marketCloseByTimestamp.get(timestamp) as number);
    const tickerReturns = dailyReturns(tickerCloses);
    const marketReturns = dailyReturns(marketCloses);
    const len = Math.min(tickerReturns.length, marketReturns.length);
    marketCorrelation[ticker] = pearsonCorrelation(tickerReturns.slice(0, len), marketReturns.slice(0, len));
  }

  const result: CorrelationResult = {
    tickers: validTickers,
    matrix,
    marketCorrelation,
    failedTickers,
    calculatedAt: new Date().toISOString(),
  };

  repo.saveCorrelationCache(result);
  return result;
}

export function clearCorrelationCache(repo: StockAnalyticsRepository): void {
  repo.clearCorrelationCache();
}

export function getSharpeCache(repo: StockAnalyticsRepository): SharpeResult | undefined {
  return repo.getSharpeCache();
}

/** Computes the portfolio-wide Sharpe ratio (value-weighted across eligible positions) and caches it. */
export async function computeSharpe(
  repo: StockAnalyticsRepository,
  client: MarketDataClient,
  positions: StockPosition[],
  input: ComputeSharpeInput,
): Promise<SharpeResult> {
  const validated = computeSharpeInputSchema.parse(input);
  const eligible = selectAnalyticsEligiblePositions(positions);
  if (eligible.length === 0) {
    throw new Error("No Stock or ETF positions found.");
  }

  const yahooRange = lookbackDaysToYahooRange(validated.lookbackDays);
  const skippedTickers: string[] = [];
  const skipReasons: Record<string, string> = {};
  const historyByTicker: Record<string, { timestamp: number; closeCents: number }[]> = {};

  for (const position of eligible) {
    try {
      const history = await client.getHistory(position.ticker, yahooRange, HISTORY_INTERVAL_1D);
      if (history.length < MINIMUM_RETURN_OBSERVATIONS + 1) {
        skippedTickers.push(position.ticker);
        skipReasons[position.ticker] = `Only ${history.length} trading days returned`;
      } else {
        historyByTicker[position.ticker] = history;
      }
    } catch {
      skippedTickers.push(position.ticker);
      skipReasons[position.ticker] = "Price history unavailable";
    }
  }

  const validPositions = eligible.filter((position) => historyByTicker[position.ticker]);
  if (validPositions.length === 0) {
    throw new Error(`No price data available for any position. Skipped: ${skippedTickers.join(", ")}`);
  }

  const weights = computePortfolioWeights(
    validPositions.map((position) => ({
      ticker: position.ticker,
      shares: position.quantity,
      priceCents: position.currentPriceCents,
    })),
  );
  if (Object.keys(weights).length === 0) {
    throw new Error("Unable to compute portfolio weights — all position values are zero.");
  }

  const { timestamps, closesByTicker } = alignSeriesByTimestamp(
    Object.fromEntries(Object.keys(weights).map((ticker) => [ticker, historyByTicker[ticker]])),
  );
  if (timestamps.length === 0) {
    throw new Error("No overlapping trading days across positions after alignment.");
  }

  const returnsByTicker: Record<string, number[]> = {};
  for (const ticker of Object.keys(closesByTicker)) {
    returnsByTicker[ticker] = dailyReturns(closesByTicker[ticker]);
  }

  const returnTimestamps = timestamps.slice(1);
  const portfolioDailyReturns = computePortfolioDailyReturns(returnsByTicker, weights);
  const portfolioReturnSeries = returnTimestamps.map((timestamp, index) => ({
    timestamp,
    dailyReturn: portfolioDailyReturns[index],
  }));

  const calculationDate = new Date().toISOString().slice(0, 10);
  const calculatedAt = new Date().toISOString();
  const dailyRf = dailyRiskFreeRate(validated.riskFreeRate);

  if (portfolioDailyReturns.length < MINIMUM_RETURN_OBSERVATIONS) {
    const result: SharpeResult = {
      sharpeRatio: null,
      annualizedReturn: 0,
      annualizedVolatility: 0,
      riskFreeRate: validated.riskFreeRate,
      lookbackDays: validated.lookbackDays,
      calculationDate,
      skippedTickers,
      skipReasons,
      insufficientDataReason: `Only ${portfolioDailyReturns.length} aligned trading days (minimum ${MINIMUM_RETURN_OBSERVATIONS} required)`,
      portfolioReturnSeries,
      tickerDetails: [],
      alignedTradingDays: portfolioDailyReturns.length,
      meanDailyReturn: 0,
      dailyRiskFreeRate: dailyRf,
      calculatedAt,
    };
    repo.saveSharpeCache(result);
    return result;
  }

  const annualizedReturnValue = annualizeReturn(portfolioDailyReturns);
  const excessReturns = portfolioDailyReturns.map((value) => value - dailyRf);
  const annualizedVolatility = annualizeStdDev(excessReturns);
  const sharpeRatio = computeSharpeRatioStat(annualizedReturnValue, validated.riskFreeRate, annualizedVolatility);
  const meanDailyReturn =
    portfolioDailyReturns.reduce((sum, value) => sum + value, 0) / portfolioDailyReturns.length;

  const tickerDetails: SharpeTickerDetail[] = Object.entries(weights)
    .map(([ticker, weight]) => {
      const position = validPositions.find((candidate) => candidate.ticker === ticker);
      const tickerReturns = returnsByTicker[ticker] ?? [];
      const tickerExcess = tickerReturns.map((value) => value - dailyRf);
      return {
        ticker,
        shares: position?.quantity ?? 0,
        currentPriceCents: position?.currentPriceCents ?? 0,
        positionValueCents: position ? Math.round(position.quantity * position.currentPriceCents) : 0,
        weight,
        annualizedReturn: annualizeReturn(tickerReturns),
        annualizedVolatility: annualizeStdDev(tickerExcess),
        tradingDays: tickerReturns.length,
      };
    })
    .sort((a, b) => b.weight - a.weight);

  const result: SharpeResult = {
    sharpeRatio,
    annualizedReturn: annualizedReturnValue,
    annualizedVolatility,
    riskFreeRate: validated.riskFreeRate,
    lookbackDays: validated.lookbackDays,
    calculationDate,
    skippedTickers,
    skipReasons,
    insufficientDataReason: sharpeRatio === null ? "Annualized volatility is zero." : undefined,
    portfolioReturnSeries,
    tickerDetails,
    alignedTradingDays: portfolioDailyReturns.length,
    meanDailyReturn,
    dailyRiskFreeRate: dailyRf,
    calculatedAt,
  };

  repo.saveSharpeCache(result);
  return result;
}
