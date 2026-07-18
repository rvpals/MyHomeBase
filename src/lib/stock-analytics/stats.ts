// Pure statistics — no I/O, no DB, no network. Ported from the source PWA's
// volatility.js/correlation.js/sharpe.js route handlers.

const TRADING_DAYS_PER_YEAR = 252;

/** Day-over-day simple returns: (close[i] - close[i-1]) / close[i-1]. */
export function dailyReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] !== 0) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return returns;
}

/** Day-over-day log returns, used for volatility (matches the source's log-return convention). */
export function dailyLogReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  return returns;
}

/** Pearson correlation coefficient, clamped to [-1, 1]. Null when undefined (constant series, <2 points). */
export function pearsonCorrelation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;

  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i];
    sumB += b[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let numerator = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = 0; i < n; i++) {
    const deviationA = a[i] - meanA;
    const deviationB = b[i] - meanB;
    numerator += deviationA * deviationB;
    varianceA += deviationA * deviationA;
    varianceB += deviationB * deviationB;
  }

  const denominator = Math.sqrt(varianceA * varianceB);
  if (denominator === 0) return null;
  return Math.max(-1, Math.min(1, numerator / denominator));
}

export interface VolatilityStats {
  annualizedVolPct: number;
  dailyStdDevPct: number;
}

/** Annualized volatility from daily log returns (sample stdev * sqrt(252)). */
export function computeVolatilityStats(closes: number[]): VolatilityStats {
  const logReturns = dailyLogReturns(closes);
  if (logReturns.length < 2) return { annualizedVolPct: 0, dailyStdDevPct: 0 };

  const mean = logReturns.reduce((sum, value) => sum + value, 0) / logReturns.length;
  const variance =
    logReturns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (logReturns.length - 1);
  const dailyStdDev = Math.sqrt(variance);

  return {
    dailyStdDevPct: dailyStdDev * 100,
    annualizedVolPct: dailyStdDev * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100,
  };
}

export function classifyVolatility(annualizedVolPct: number): "Low" | "Moderate" | "High" | "Very High" {
  if (annualizedVolPct < 15) return "Low";
  if (annualizedVolPct < 30) return "Moderate";
  if (annualizedVolPct < 60) return "High";
  return "Very High";
}

/** Where the current price sits within [low, high], as a 0-100 percentage. 50 when low === high. */
export function computeRangePositionPct(price: number, low: number, high: number): number {
  if (high <= low) return 50;
  return Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100));
}

/** Inner-joins per-ticker price series on shared timestamps, sorted ascending. */
export function alignSeriesByTimestamp(
  seriesByTicker: Record<string, { timestamp: number; closeCents: number }[]>,
): { timestamps: number[]; closesByTicker: Record<string, number[]> } {
  const tickers = Object.keys(seriesByTicker);
  if (tickers.length === 0) return { timestamps: [], closesByTicker: {} };

  const timestampSets = tickers.map((ticker) => new Set(seriesByTicker[ticker].map((point) => point.timestamp)));
  let commonTimestamps = [...timestampSets[0]];
  for (let i = 1; i < timestampSets.length; i++) {
    commonTimestamps = commonTimestamps.filter((timestamp) => timestampSets[i].has(timestamp));
  }
  commonTimestamps.sort((a, b) => a - b);

  const closesByTicker: Record<string, number[]> = {};
  for (const ticker of tickers) {
    const closeByTimestamp = new Map(seriesByTicker[ticker].map((point) => [point.timestamp, point.closeCents]));
    closesByTicker[ticker] = commonTimestamps
      .map((timestamp) => closeByTimestamp.get(timestamp))
      .filter((close): close is number => close != null);
  }

  return { timestamps: commonTimestamps, closesByTicker };
}

/** Position-value weights (0-1, summing to 1) for a set of holdings. Empty if total value is zero. */
export function computePortfolioWeights(
  holdings: { ticker: string; shares: number; priceCents: number }[],
): Record<string, number> {
  const values: Record<string, number> = {};
  let total = 0;
  for (const holding of holdings) {
    if (holding.shares <= 0 || holding.priceCents <= 0) continue;
    values[holding.ticker] = holding.shares * holding.priceCents;
    total += values[holding.ticker];
  }
  if (total <= 0) return {};

  const weights: Record<string, number> = {};
  for (const ticker of Object.keys(values)) {
    weights[ticker] = values[ticker] / total;
  }
  return weights;
}

/** Value-weighted daily return series across tickers, truncated to the shortest series. */
export function computePortfolioDailyReturns(
  returnsByTicker: Record<string, number[]>,
  weights: Record<string, number>,
): number[] {
  const activeTickers = Object.keys(returnsByTicker).filter((ticker) => weights[ticker] != null);
  if (activeTickers.length === 0) return [];

  const length = Math.min(...activeTickers.map((ticker) => returnsByTicker[ticker].length));
  if (length === 0) return [];

  return Array.from({ length }, (_, day) =>
    activeTickers.reduce((sum, ticker) => sum + weights[ticker] * returnsByTicker[ticker][day], 0),
  );
}

export function annualizeReturn(returns: number[]): number {
  if (returns.length === 0) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  return mean * TRADING_DAYS_PER_YEAR;
}

export function dailyRiskFreeRate(annualRate: number): number {
  return annualRate / TRADING_DAYS_PER_YEAR;
}

/** Sample stdev of excess returns, annualized. */
export function annualizeStdDev(returns: number[]): number {
  const n = returns.length;
  if (n < 2) return 0;
  const mean = returns.reduce((sum, value) => sum + value, 0) / n;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR);
}

/** Rounded to 2 decimal places; null when volatility is zero (undefined ratio). */
export function computeSharpeRatio(
  annualizedReturn: number,
  riskFreeRate: number,
  annualizedVolatility: number,
): number | null {
  if (annualizedVolatility === 0) return null;
  return Math.round(((annualizedReturn - riskFreeRate) / annualizedVolatility) * 100) / 100;
}

/** Maps a lookback window to a Yahoo chart "range" string. */
export function lookbackDaysToYahooRange(lookbackDays: number): string {
  if (lookbackDays <= 180) return "6mo";
  if (lookbackDays <= 365) return "1y";
  if (lookbackDays <= 730) return "2y";
  if (lookbackDays <= 1825) return "5y";
  return "10y";
}
